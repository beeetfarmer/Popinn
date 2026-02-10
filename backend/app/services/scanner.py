import logging
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.models.artist import Artist
from app.models.subtitle import Subtitle, SubtitleFormat
from app.models.video import Video
from app.services.lastfm import download_artist_image, fetch_artist_info
from app.services.metadata import extract_metadata, generate_thumbnail

logger = logging.getLogger(__name__)

VIDEO_EXTENSIONS = {".mp4", ".mkv", ".avi", ".webm", ".mov"}
SUBTITLE_EXTENSIONS = {".srt", ".vtt"}


@dataclass
class ScanResult:
    files_found: int = 0
    files_added: int = 0
    errors: list[str] = field(default_factory=list)


def _find_or_create_artist(session: Session, folder_name: str) -> tuple[Artist, bool]:
    """Find an existing artist or create a new one. Returns (artist, is_new)."""
    result = session.execute(
        select(Artist).where(Artist.name == folder_name)
    )
    artist = result.scalar_one_or_none()
    if artist:
        # Restore if soft-deleted
        if artist.deleted_at is not None:
            artist.deleted_at = None
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
) -> bool:
    """Process a single video file. Returns True if added, False if skipped."""
    result = session.execute(
        select(Video).where(Video.file_path == file_path)
    )
    existing = result.scalar_one_or_none()
    if existing:
        if existing.deleted_at is not None:
            existing.deleted_at = None
            session.flush()
        return False

    title = _parse_title(os.path.basename(file_path), artist_name)
    meta = extract_metadata(file_path)

    video_id = uuid.uuid4()
    thumb_filename = f"{video_id}.jpg"
    thumb_path = os.path.join(thumbnail_dir, thumb_filename)
    thumb_ok = generate_thumbnail(file_path, thumb_path)

    video = Video(
        id=video_id,
        title=title,
        artist_id=artist.id,
        file_path=file_path,
        duration=meta["duration"],
        file_size=meta["file_size"],
        thumbnail_path=thumb_path if thumb_ok else None,
    )
    session.add(video)
    session.flush()
    return True


def _process_subtitles(
    session: Session,
    artist_dir: str,
    video_map: dict[str, Video],
) -> None:
    """Find subtitle files and link them to matching videos.

    Handles yt-dlp naming convention: video.LANG.srt / video.LANG.vtt
    as well as plain: video.srt / video.vtt
    """
    import re

    for entry in os.scandir(artist_dir):
        if not entry.is_file():
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


def _soft_delete_missing(session: Session, media_path: str) -> None:
    """Soft-delete videos whose files no longer exist on disk."""
    result = session.execute(
        select(Video).where(Video.deleted_at.is_(None))
    )
    for video in result.scalars():
        if not os.path.exists(video.file_path):
            video.deleted_at = datetime.now(timezone.utc)
    session.flush()


def run_scan(
    session_factory: sessionmaker,
    media_path: str,
    lastfm_api_key: str,
    thumbnail_dir: str,
) -> ScanResult:
    """Walk media_path and sync all artists/videos/subtitles to the DB."""
    result = ScanResult()
    thumbnail_dir = os.path.join(media_path, thumbnail_dir)
    os.makedirs(thumbnail_dir, exist_ok=True)

    with session_factory() as session:
        try:
            for entry in sorted(os.scandir(media_path), key=lambda e: e.name):
                if not entry.is_dir() or entry.name.startswith("."):
                    continue

                artist_name = entry.name
                artist, is_new = _find_or_create_artist(session, artist_name)

                # Check if existing image is a placeholder (< 10KB)
                has_real_image = False
                if artist.image_path and os.path.exists(artist.image_path):
                    has_real_image = os.path.getsize(artist.image_path) > 10_000
                needs_image = not has_real_image

                # Fetch Last.fm info for new artists or artists missing/placeholder images
                if lastfm_api_key and (is_new or needs_image or not artist.bio):
                    info = fetch_artist_info(artist_name, lastfm_api_key)
                    if info:
                        if info.get("bio") and not artist.bio:
                            artist.bio = info["bio"]
                        if info.get("image_url") and needs_image:
                            img_path = os.path.join(entry.path, ".artist.jpg")
                            if download_artist_image(info["image_url"], img_path):
                                artist.image_path = img_path
                    session.flush()

                # Collect video files in this artist folder
                video_map: dict[str, Video] = {}
                for fentry in sorted(os.scandir(entry.path), key=lambda e: e.name):
                    if not fentry.is_file():
                        continue
                    ext = Path(fentry.name).suffix.lower()
                    if ext not in VIDEO_EXTENSIONS:
                        continue

                    result.files_found += 1
                    try:
                        added = _process_video(
                            session, fentry.path, artist, artist_name, thumbnail_dir
                        )
                        if added:
                            result.files_added += 1
                        # Build map for subtitle matching
                        vid_result = session.execute(
                            select(Video).where(Video.file_path == fentry.path)
                        )
                        video = vid_result.scalar_one_or_none()
                        if video:
                            video_map[Path(fentry.name).stem] = video
                    except Exception as e:
                        msg = f"Error processing {fentry.path}: {e}"
                        logger.error(msg)
                        result.errors.append(msg)

                # Process subtitles for this artist folder
                _process_subtitles(session, entry.path, video_map)

            # Soft-delete videos whose files are gone
            _soft_delete_missing(session, media_path)

            session.commit()
        except Exception as e:
            session.rollback()
            msg = f"Scan failed: {e}"
            logger.exception(msg)
            result.errors.append(msg)

    return result
