import logging
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.models.artist import Artist
from app.models.subtitle import Subtitle, SubtitleFormat
from app.models.video import Video
from app.services.lastfm import (
    fetch_artist_info,
    is_lastfm_attributed_bio,
)
from app.services.metadata import (
    extract_metadata,
    generate_preview_clip,
    generate_thumbnail,
)
from app.services.path_urls import is_external_url

logger = logging.getLogger(__name__)

VIDEO_EXTENSIONS = {".mp4", ".mkv", ".avi", ".webm", ".mov"}
SUBTITLE_EXTENSIONS = {".srt", ".vtt"}
ScanProgressCallback = Callable[[int, int, str | None, int, int], None]
CancelCheckCallback = Callable[[], bool]


class ScanCancelledError(Exception):
    pass


@dataclass
class ScanResult:
    files_found: int = 0
    files_added: int = 0
    cancelled: bool = False
    errors: list[str] = field(default_factory=list)


def _is_within_root(path: str | Path, root: Path) -> bool:
    try:
        Path(path).resolve(strict=False).relative_to(root)
        return True
    except ValueError:
        return False


def _find_or_create_artist(session: Session, folder_name: str) -> tuple[Artist, bool]:
    """Find an existing artist or create a new one. Returns (artist, is_new).

    If the artist was soft-deleted by the user, restore it only when new
    video files need to be added (caller decides). Otherwise return the
    existing record as-is so we can still check for videos.
    """
    result = session.execute(
        select(Artist).where(Artist.name == folder_name)
    )
    artist = result.scalar_one_or_none()
    if artist:
        return artist, False

    artist = Artist(name=folder_name)
    session.add(artist)
    session.flush()
    return artist, True


def _parse_title(filename: str, artist_name: str) -> str:
    """Strip artist prefix from filename to get a clean title."""
    stem = Path(filename).stem
    # Try "Artist - Title" pattern
    prefix = f"{artist_name} - "
    if stem.startswith(prefix):
        return stem[len(prefix):]
    # Try "Artist- Title" or "Artist -Title" etc.
    if " - " in stem:
        parts = stem.split(" - ", 1)
        if parts[0].strip().lower() == artist_name.lower():
            return parts[1].strip()
    return stem


def _process_video(
    session: Session,
    file_path: str,
    artist: Artist,
    artist_name: str,
    thumbnail_dir: str,
    preview_dir: str,
) -> bool:
    """Process a single video file. Returns True if added, False if skipped."""
    result = session.execute(
        select(Video).where(Video.file_path == file_path)
    )
    existing = result.scalar_one_or_none()
    if existing:
        # Already tracked (active or user-deleted) — skip it
        return False

    title = _parse_title(os.path.basename(file_path), artist_name)
    meta = extract_metadata(file_path)

    video_id = uuid.uuid4()
    thumb_filename = f"{video_id}.jpg"
    thumb_path = os.path.join(thumbnail_dir, thumb_filename)
    thumb_ok = generate_thumbnail(file_path, thumb_path)
    preview_filename = f"{video_id}.mp4"
    preview_path = os.path.join(preview_dir, preview_filename)
    preview_ok = generate_preview_clip(file_path, preview_path, start_seconds=5, clip_seconds=10)

    video = Video(
        id=video_id,
        title=title,
        artist_id=artist.id,
        file_path=file_path,
        duration=meta["duration"],
        file_size=meta["file_size"],
        thumbnail_path=thumb_path if thumb_ok else None,
        preview_path=preview_path if preview_ok else None,
    )
    session.add(video)
    session.flush()
    return True


def _ensure_video_assets(
    video: Video,
    *,
    file_path: str,
    thumbnail_dir: str,
    preview_dir: str,
) -> bool:
    """Backfill missing generated assets for existing active videos."""
    if video.deleted_at is not None:
        return False
    changed = False

    thumb_missing = (
        not video.thumbnail_path
        or not os.path.exists(video.thumbnail_path)
    )
    if thumb_missing:
        thumb_path = os.path.join(thumbnail_dir, f"{video.id}.jpg")
        if generate_thumbnail(file_path, thumb_path):
            video.thumbnail_path = thumb_path
            changed = True

    preview_missing = (
        not video.preview_path
        or not os.path.exists(video.preview_path)
    )
    if preview_missing:
        preview_path = os.path.join(preview_dir, f"{video.id}.mp4")
        if generate_preview_clip(file_path, preview_path, start_seconds=5, clip_seconds=10):
            video.preview_path = preview_path
            changed = True

    return changed


def _process_subtitles(
    session: Session,
    artist_dir: str,
    video_map: dict[str, Video],
    media_root: Path,
) -> None:
    """Find subtitle files and link them to matching videos.

    Handles yt-dlp naming convention: video.LANG.srt / video.LANG.vtt
    as well as plain: video.srt / video.vtt
    """
    import re

    for entry in os.scandir(artist_dir):
        if not entry.is_file(follow_symlinks=False):
            continue
        if not _is_within_root(entry.path, media_root):
            continue
        ext = Path(entry.name).suffix.lower()
        if ext not in SUBTITLE_EXTENSIONS:
            continue

        stem = Path(entry.name).stem  # e.g. "video.en" or "video"

        # Try direct stem match first
        video = video_map.get(stem)
        language = "und"

        # If no match, try stripping a language code suffix (yt-dlp: video.en.srt)
        if not video:
            lang_match = re.match(r"^(.+)\.([a-z]{2,3})$", stem)
            if lang_match:
                base_stem, lang_code = lang_match.groups()
                video = video_map.get(base_stem)
                if video:
                    language = lang_code

        if not video:
            continue

        # Check if subtitle already exists
        result = session.execute(
            select(Subtitle).where(Subtitle.file_path == entry.path)
        )
        if result.scalar_one_or_none():
            continue

        fmt = SubtitleFormat.srt if ext == ".srt" else SubtitleFormat.vtt
        subtitle = Subtitle(
            video_id=video.id,
            file_path=entry.path,
            language=language,
            format=fmt,
        )
        session.add(subtitle)

    session.flush()


def _process_subtitles_for_video(
    session: Session,
    *,
    artist_dir: str,
    video_filename: str,
    video: Video,
    media_root: Path,
) -> None:
    """Attach subtitles for a single video by matching sibling subtitle files."""
    import re

    stem = Path(video_filename).stem

    for entry in os.scandir(artist_dir):
        if not entry.is_file(follow_symlinks=False):
            continue
        if not _is_within_root(entry.path, media_root):
            continue
        ext = Path(entry.name).suffix.lower()
        if ext not in SUBTITLE_EXTENSIONS:
            continue

        sub_stem = Path(entry.name).stem
        language = "und"
        matched = sub_stem == stem
        if not matched:
            lang_match = re.match(r"^(.+)\.([a-z]{2,3})$", sub_stem)
            if lang_match:
                base_stem, lang_code = lang_match.groups()
                if base_stem == stem:
                    matched = True
                    language = lang_code
        if not matched:
            continue

        existing = session.execute(
            select(Subtitle).where(Subtitle.file_path == entry.path)
        ).scalar_one_or_none()
        if existing:
            continue

        fmt = SubtitleFormat.srt if ext == ".srt" else SubtitleFormat.vtt
        session.add(
            Subtitle(
                video_id=video.id,
                file_path=entry.path,
                language=language,
                format=fmt,
            )
        )
    session.flush()


def _soft_delete_missing(session: Session, media_path: str) -> None:
    """Soft-delete videos whose files no longer exist on disk."""
    media_root = Path(media_path).resolve(strict=False)
    result = session.execute(
        select(Video).where(Video.deleted_at.is_(None))
    )
    for video in result.scalars():
        if not _is_within_root(video.file_path, media_root) or not os.path.exists(video.file_path):
            video.deleted_at = datetime.now(timezone.utc)
    session.flush()


def _raise_if_cancelled(should_cancel: CancelCheckCallback | None) -> None:
    if should_cancel and should_cancel():
        raise ScanCancelledError("Scan cancelled by user")


def run_scan(
    session_factory: sessionmaker,
    media_path: str,
    app_data_path: str,
    lastfm_api_key: str,
    lastfm_cache_ttl_hours: int,
    thumbnail_dir: str,
    preview_dir: str,
    override_local_artist_images: bool = True,
    progress_callback: ScanProgressCallback | None = None,
    should_cancel: CancelCheckCallback | None = None,
) -> ScanResult:
    """Walk media_path and sync all artists/videos/subtitles to the DB."""
    result = ScanResult()
    media_root = Path(media_path).resolve(strict=False)
    thumbnail_dir = os.path.join(app_data_path, thumbnail_dir)
    preview_dir = os.path.join(app_data_path, preview_dir)
    os.makedirs(thumbnail_dir, exist_ok=True)
    os.makedirs(preview_dir, exist_ok=True)

    with session_factory() as session:
        try:
            artist_entries = []
            for entry in sorted(os.scandir(media_path), key=lambda e: e.name):
                if entry.name.startswith("."):
                    continue
                if not entry.is_dir(follow_symlinks=False):
                    continue
                if not _is_within_root(entry.path, media_root):
                    continue
                artist_entries.append(entry)
            folders_total = len(artist_entries)
            if progress_callback:
                progress_callback(folders_total, 0, None, result.files_found, result.files_added)

            for idx, entry in enumerate(artist_entries):
                _raise_if_cancelled(should_cancel)
                if progress_callback:
                    progress_callback(
                        folders_total,
                        idx,
                        entry.name,
                        result.files_found,
                        result.files_added,
                    )

                artist_name = entry.name
                artist, is_new = _find_or_create_artist(session, artist_name)

                # Determine whether existing image looks usable.
                has_real_image = False
                if artist.image_path:
                    if is_external_url(artist.image_path):
                        has_real_image = True
                    elif os.path.exists(artist.image_path):
                        has_real_image = os.path.getsize(artist.image_path) > 10_000
                needs_image = not has_real_image

                # External URLs are considered Last.fm-managed images in this flow.
                is_lastfm_image = bool(artist.image_path and is_external_url(artist.image_path))
                bio_is_lastfm = is_lastfm_attributed_bio(artist.bio)
                ttl_hours = max(1, int(lastfm_cache_ttl_hours))
                now_utc = datetime.now(timezone.utc)
                cache_stale = (
                    artist.lastfm_fetched_at is None
                    or artist.lastfm_fetched_at <= now_utc - timedelta(hours=ttl_hours)
                )

                # Refresh Last.fm metadata if missing or stale; stale third-party data is not kept forever.
                should_refresh_lastfm = bool(lastfm_api_key) and (
                    is_new
                    or needs_image
                    or not artist.bio
                    or (cache_stale and (bio_is_lastfm or is_lastfm_image))
                )

                if should_refresh_lastfm:
                    lookup_name = (artist.lastfm_artist_name or artist_name).strip()
                    info = fetch_artist_info(lookup_name, lastfm_api_key)
                    if info:
                        fetched_bio = info.get("bio")
                        fetched_image_url = info.get("image_url")
                        canonical_name = (info.get("artist_name") or lookup_name).strip()
                        artist.lastfm_artist_name = canonical_name

                        if fetched_bio and (not artist.bio or bio_is_lastfm or cache_stale):
                            artist.bio = info["bio"]
                        elif cache_stale and bio_is_lastfm and not fetched_bio:
                            artist.bio = None

                        can_update_image = (
                            override_local_artist_images
                            or needs_image
                            or is_lastfm_image
                            or not artist.image_path
                        )
                        if fetched_image_url and can_update_image:
                            artist.image_path = fetched_image_url
                        elif cache_stale and is_lastfm_image and not fetched_image_url:
                            artist.image_path = None

                        artist.lastfm_fetched_at = now_utc
                    elif cache_stale:
                        if bio_is_lastfm:
                            artist.bio = None
                        if is_lastfm_image:
                            artist.image_path = None
                        if bio_is_lastfm or is_lastfm_image:
                            artist.lastfm_fetched_at = None
                    session.flush()

                # Collect video files in this artist folder
                video_map: dict[str, Video] = {}
                artist_added_count = 0
                for fentry in sorted(os.scandir(entry.path), key=lambda e: e.name):
                    _raise_if_cancelled(should_cancel)
                    if not fentry.is_file(follow_symlinks=False):
                        continue
                    if not _is_within_root(fentry.path, media_root):
                        continue
                    ext = Path(fentry.name).suffix.lower()
                    if ext not in VIDEO_EXTENSIONS:
                        continue

                    result.files_found += 1
                    try:
                        added = _process_video(
                            session,
                            fentry.path,
                            artist,
                            artist_name,
                            thumbnail_dir,
                            preview_dir,
                        )
                        if added:
                            result.files_added += 1
                            artist_added_count += 1
                        # Build map for subtitle matching
                        vid_result = session.execute(
                            select(Video).where(Video.file_path == fentry.path)
                        )
                        video = vid_result.scalar_one_or_none()
                        if video:
                            if _ensure_video_assets(
                                video,
                                file_path=fentry.path,
                                thumbnail_dir=thumbnail_dir,
                                preview_dir=preview_dir,
                            ):
                                session.flush()
                            video_map[Path(fentry.name).stem] = video
                            _process_subtitles_for_video(
                                session,
                                artist_dir=entry.path,
                                video_filename=fentry.name,
                                video=video,
                                media_root=media_root,
                            )
                        # Commit per video so newly added items become visible during long scans.
                        session.commit()
                    except Exception as e:
                        msg = f"Error processing {fentry.path}: {e}"
                        logger.error(msg)
                        result.errors.append(msg)
                        session.rollback()
                    finally:
                        if progress_callback:
                            progress_callback(
                                folders_total,
                                idx,
                                entry.name,
                                result.files_found,
                                result.files_added,
                            )

                # Restore artist if new videos were added and artist was deleted
                if artist_added_count > 0 and artist.deleted_at is not None:
                    artist.deleted_at = None
                    session.flush()
                    session.commit()

                # Process subtitles for this artist folder
                _process_subtitles(session, entry.path, video_map, media_root)
                session.commit()

                if progress_callback:
                    progress_callback(
                        folders_total,
                        idx + 1,
                        entry.name,
                        result.files_found,
                        result.files_added,
                    )

            _raise_if_cancelled(should_cancel)
            # Soft-delete videos whose files are gone
            _soft_delete_missing(session, media_path)
            session.commit()
            if progress_callback:
                progress_callback(
                    folders_total,
                    folders_total,
                    None,
                    result.files_found,
                    result.files_added,
                )
        except ScanCancelledError as e:
            session.rollback()
            result.cancelled = True
            result.errors.append(str(e))
        except Exception as e:
            session.rollback()
            msg = f"Scan failed: {e}"
            logger.exception(msg)
            result.errors.append(msg)

    return result


def refresh_artist_metadata(
    session_factory: sessionmaker,
    lastfm_api_key: str,
    override_local_artist_images: bool = True,
    progress_callback: ScanProgressCallback | None = None,
    should_cancel: CancelCheckCallback | None = None,
) -> ScanResult:
    """Refresh artist bio + image metadata from Last.fm for existing artists."""
    result = ScanResult()
    if not lastfm_api_key:
        result.errors.append("Last.fm API key is not configured")
        return result

    with session_factory() as session:
        try:
            artists = (
                session.execute(
                    select(Artist)
                    .where(Artist.deleted_at.is_(None))
                    .order_by(Artist.name.asc())
                )
                .scalars()
                .all()
            )
            total = len(artists)
            if progress_callback:
                progress_callback(total, 0, None, 0, 0)

            updated_count = 0
            processed_count = 0
            for idx, artist in enumerate(artists):
                _raise_if_cancelled(should_cancel)
                if progress_callback:
                    progress_callback(total, idx, artist.name, processed_count, updated_count)

                lookup_name = (artist.lastfm_artist_name or artist.name).strip()
                info = fetch_artist_info(lookup_name, lastfm_api_key)
                processed_count += 1
                result.files_found = processed_count

                if info:
                    changed = False
                    fetched_bio = info.get("bio")
                    fetched_image_url = info.get("image_url")
                    canonical_name = (info.get("artist_name") or lookup_name).strip()

                    if artist.lastfm_artist_name != canonical_name:
                        artist.lastfm_artist_name = canonical_name
                        changed = True

                    if fetched_bio and artist.bio != fetched_bio:
                        artist.bio = fetched_bio
                        changed = True

                    if fetched_image_url and (
                        override_local_artist_images
                        or not artist.image_path
                        or is_external_url(artist.image_path)
                    ):
                        if artist.image_path != fetched_image_url:
                            artist.image_path = fetched_image_url
                            changed = True

                    if changed:
                        artist.lastfm_fetched_at = datetime.now(timezone.utc)
                        updated_count += 1
                        result.files_added = updated_count

                if progress_callback:
                    progress_callback(
                        total,
                        idx + 1,
                        artist.name,
                        processed_count,
                        updated_count,
                    )

            _raise_if_cancelled(should_cancel)
            session.commit()
            if progress_callback:
                progress_callback(
                    total,
                    total,
                    None,
                    result.files_found,
                    result.files_added,
                )
        except ScanCancelledError as e:
            session.rollback()
            result.cancelled = True
            result.errors.append(str(e))
        except Exception as e:
            session.rollback()
            msg = f"Artist metadata refresh failed: {e}"
            logger.exception(msg)
            result.errors.append(msg)

    return result
