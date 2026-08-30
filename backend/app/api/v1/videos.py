import asyncio
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_admin, get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.artist import Artist
from app.models.playback import VideoPlay
from app.models.user import User
from app.models.video import Video
from app.schemas.video import (
    TranscodeRunStatus,
    TranscodeStatus,
    VideoBulkDelete,
    VideoRecommendationRead,
    VideoRecommendationsPage,
    VideoPlayCreate,
    VideoPlayRead,
    VideoPlayStats,
    VideoPage,
    VideoRead,
    SpotifyTrackMatch,
    VideoUpdate,
)
from app.services.background_jobs import submit_job
from app.services.lastfm import fetch_similar_tracks, normalize_for_match
from app.services.media_assets import delete_video_assets
from app.services.metadata import playlist_is_complete
from app.services.path_urls import to_public_asset_url
from app.services.playback import is_counted_view
from app.services.runtime_settings import (
    get_effective_app_data_path,
    get_effective_media_path,
    get_effective_metadata_provider,
    get_effective_transcoding_enabled,
    get_effective_view_threshold_ratio,
)
from app.services.stream_tokens import sign_stream_url_for_user
from app.services.transcode_status import get_run, needs_transcode
from app.services.musicbrainz import (
    MusicBrainzServiceError,
    search_tracks as musicbrainz_search_tracks,
)
from app.services.spotify import (
    SpotifyRateLimitError,
    SpotifyServiceError,
    search_tracks,
)
from app.tasks.media import generate_hls_for_video, transcode_one_and_report

router = APIRouter(prefix="/videos", tags=["videos"])

SORTABLE_COLUMNS = {
    # What a user means by "date added": when the file appeared, not when this
    # row was written. Falls back to added_at for rows the scanner has not
    # backfilled yet, so ordering stays sensible during the transition.
    "file_created_at": func.coalesce(Video.file_created_at, Video.added_at),
    "added_at": Video.added_at,
    "title": Video.title,
    "year": Video.year,
    "album": Video.album,
}


def _asset_url(
    abs_path_or_url: str | None,
    media_root: str,
    app_data_root: str,
    user_id: uuid.UUID | None = None,
) -> str | None:
    signer = None
    if user_id is not None:
        signer = lambda url: sign_stream_url_for_user(url, user_id) or url
    return to_public_asset_url(
        abs_path_or_url,
        media_root=media_root,
        app_data_root=app_data_root,
        signer=signer,
    )


def _hls_playlist_url(
    video_id: uuid.UUID,
    app_data_root: str,
    user_id: uuid.UUID | None = None,
) -> str | None:
    playlist = Path(app_data_root) / settings.HLS_DIR / str(video_id) / "index.m3u8"
    # Completeness, not mere existence: a truncated playlist from a killed
    # transcode plays as a live stream (no seek bar, starts mid-video). Treating
    # it as absent falls back to direct streaming and lets a retry regenerate it.
    if not playlist_is_complete(playlist):
        return None
    # Version the URL by the playlist's mtime. Sending no-store only governs
    # responses cached from now on; a client that cached a truncated playlist
    # while transcoding was broken would keep replaying it, and because hls.js
    # fetches the manifest over XHR a hard reload does not reliably evict it.
    # Regenerating changes the mtime, which changes the cache key, so a stale
    # entry can never be reused.
    try:
        version = int(playlist.stat().st_mtime)
    except OSError:
        version = 0
    url = f"/data/{settings.HLS_DIR}/{video_id}/index.m3u8?v={version}"
    if user_id is not None:
        return sign_stream_url_for_user(url, user_id)
    return url


def _video_to_read(
    video: Video,
    artist_name: str,
    media_root: str,
    app_data_root: str,
    transcoding_enabled: bool,
    user_id: uuid.UUID | None = None,
) -> VideoRead:
    video_url = _asset_url(video.file_path, media_root, app_data_root, user_id)
    hls_url = (
        _hls_playlist_url(video.id, app_data_root, user_id) if transcoding_enabled else None
    )
    return VideoRead(
        id=video.id,
        title=video.title,
        artist_id=video.artist_id,
        artist_name=artist_name,
        album=video.album,
        duration=video.duration,
        thumbnail_url=_asset_url(video.thumbnail_path, media_root, app_data_root, user_id),
        preview_url=_asset_url(video.preview_path, media_root, app_data_root, user_id),
        video_url=video_url,
        playback_url=hls_url or video_url,
        year=video.year,
        genre=video.genre,
        file_size=video.file_size,
        added_at=video.added_at,
    )


@router.get("/genres", response_model=list[str])
async def list_genres(
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Every genre present in the library.

    Derived server-side because a client that only holds one page cannot know
    which genres exist -- offering a filter built from the current page would
    hide most of them.
    """
    result = await db.execute(
        select(Video.genre)
        .where(Video.deleted_at.is_(None), Video.genre.is_not(None))
        .distinct()
        .order_by(Video.genre)
    )
    return [genre for genre in result.scalars().all() if genre]


@router.get("/", response_model=VideoPage)
async def list_videos(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    search: str | None = Query(None, max_length=200),
    artist_id: uuid.UUID | None = Query(None),
    genre: str | None = Query(None, max_length=100),
    sort_by: str = Query("file_created_at"),
    sort_order: str = Query("desc"),
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    filters = [Video.deleted_at.is_(None)]
    if search:
        filters.append(Video.title.ilike(f"%{search}%"))
    if artist_id:
        filters.append(Video.artist_id == artist_id)
    if genre:
        filters.append(Video.genre == genre)

    total = (
        await db.scalar(select(func.count(Video.id)).where(*filters))
    ) or 0

    sort_col = SORTABLE_COLUMNS.get(sort_by, SORTABLE_COLUMNS["file_created_at"])
    query = (
        select(Video)
        .where(*filters)
        .options(selectinload(Video.artist))
        # Tie-broken by id so paging is stable. Without it, rows sharing a sort
        # value (a whole library scanned in one pass, or an unset year) can be
        # returned in a different order per query, which makes videos appear
        # twice or not at all as the offset moves.
        .order_by(
            sort_col.asc() if sort_order == "asc" else sort_col.desc(),
            Video.id.asc(),
        )
        .offset(skip)
        .limit(limit)
    )

    result = await db.execute(query)
    videos = result.scalars().all()
    media_root = await get_effective_media_path(db)
    app_data_root = await get_effective_app_data_path(db)
    transcoding_enabled = await get_effective_transcoding_enabled(db)
    return VideoPage(
        items=[
            _video_to_read(
                v,
                v.artist.name if v.artist else "",
                media_root,
                app_data_root,
                transcoding_enabled,
                _user.id,
            )
            for v in videos
        ],
        total=total,
        skip=skip,
        limit=limit,
    )


@router.get("/spotify/search", response_model=list[SpotifyTrackMatch])
async def search_spotify_tracks(
    q: str = Query(..., min_length=1, max_length=200),
    artist_name: str | None = Query(None, max_length=120),
    limit: int = Query(10, ge=1, le=20),
    _admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    # Endpoint kept at /spotify/search for compatibility; the active provider is
    # a runtime setting (Spotify by default, MusicBrainz for accountless setups).
    if await get_effective_metadata_provider(db) == "musicbrainz":
        try:
            return await musicbrainz_search_tracks(query=q, artist_name=artist_name, limit=limit)
        except MusicBrainzServiceError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=str(exc),
            ) from exc

    client_id = settings.SPOTIFY_CLIENT_ID.strip()
    client_secret = settings.SPOTIFY_CLIENT_SECRET.strip()
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Spotify integration is not configured on the server",
        )

    try:
        return await search_tracks(
            client_id=client_id,
            client_secret=client_secret,
            query=q,
            artist_name=artist_name,
            limit=limit,
        )
    except SpotifyRateLimitError as exc:
        detail = "Spotify API rate limit exceeded. Please wait and try again."
        if exc.retry_after_seconds is not None:
            detail += f" Retry after about {int(round(exc.retry_after_seconds))}s."
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=detail,
        ) from exc
    except SpotifyServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc


@router.get("/{video_id}/recommendations", response_model=VideoRecommendationsPage)
async def get_video_recommendations(
    video_id: uuid.UUID,
    offset: int = Query(0, ge=0),
    limit: int = Query(12, ge=1, le=50),
    source: Literal["lastfm", "genre"] = Query("lastfm"),
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Video)
        .where(Video.id == video_id, Video.deleted_at.is_(None))
        .options(selectinload(Video.artist))
    )
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found")

    matched: list[tuple[Video, float | None]] = []
    if source == "genre":
        genre_value = (video.genre or "").strip().lower()
        if genre_value:
            same_genre_rows = (
                await db.execute(
                    select(Video)
                    .where(
                        Video.deleted_at.is_(None),
                        Video.id != video.id,
                        Video.genre.is_not(None),
                        func.lower(func.trim(Video.genre)) == genre_value,
                    )
                    .order_by(func.random())
                    .options(selectinload(Video.artist))
                )
            ).scalars().all()
            matched = [(row, None) for row in same_genre_rows]
    else:
        api_key = settings.LASTFM_API_KEY.strip()
        if api_key:
            artist_name = video.artist.name if video.artist else ""
            fetch_limit = max(50, min(200, (offset + limit) * 4))
            similar = await asyncio.to_thread(
                fetch_similar_tracks,
                video.title,
                artist_name,
                api_key,
                limit=fetch_limit,
            )
            if similar:
                artist_rows = (
                    await db.execute(select(Artist).where(Artist.deleted_at.is_(None)))
                ).scalars().all()
                artist_ids_by_normalized: dict[str, list[uuid.UUID]] = {}
                for row in artist_rows:
                    normalized = normalize_for_match(row.name)
                    if not normalized:
                        continue
                    artist_ids_by_normalized.setdefault(normalized, []).append(row.id)

                candidate_order: list[tuple[uuid.UUID, str]] = []
                candidate_score: dict[tuple[uuid.UUID, str], float | None] = {}
                candidate_artist_ids: set[uuid.UUID] = set()
                for rec in similar:
                    normalized_artist = normalize_for_match(rec.get("artist_name"))
                    normalized_title = normalize_for_match(rec.get("title"))
                    if not normalized_artist or not normalized_title:
                        continue
                    artist_ids = artist_ids_by_normalized.get(normalized_artist)
                    if not artist_ids:
                        continue
                    for artist_id in artist_ids:
                        key = (artist_id, normalized_title)
                        if key not in candidate_score:
                            candidate_order.append(key)
                            candidate_score[key] = rec.get("match")
                        candidate_artist_ids.add(artist_id)

                if candidate_artist_ids:
                    candidate_videos = (
                        await db.execute(
                            select(Video)
                            .where(
                                Video.deleted_at.is_(None),
                                Video.artist_id.in_(candidate_artist_ids),
                            )
                            .options(selectinload(Video.artist))
                        )
                    ).scalars().all()
                    videos_by_key: dict[tuple[uuid.UUID, str], Video] = {}
                    for row in candidate_videos:
                        key = (row.artist_id, normalize_for_match(row.title))
                        if key not in videos_by_key:
                            videos_by_key[key] = row

                    seen_video_ids: set[uuid.UUID] = set()
                    for key in candidate_order:
                        matched_video = videos_by_key.get(key)
                        if not matched_video:
                            continue
                        if matched_video.id == video.id or matched_video.id in seen_video_ids:
                            continue
                        seen_video_ids.add(matched_video.id)
                        matched.append((matched_video, candidate_score.get(key)))

    total = len(matched)
    page = matched[offset : offset + limit]
    media_root = await get_effective_media_path(db)
    app_data_root = await get_effective_app_data_path(db)
    transcoding_enabled = await get_effective_transcoding_enabled(db)

    items = [
        VideoRecommendationRead(
            video=_video_to_read(
                row,
                row.artist.name if row.artist else "",
                media_root,
                app_data_root,
                transcoding_enabled,
                _user.id,
            ),
            lastfm_match=score,
        )
        for row, score in page
    ]
    return VideoRecommendationsPage(
        items=items,
        offset=offset,
        limit=limit,
        has_more=offset + limit < total,
    )


@router.get("/{video_id}", response_model=VideoRead)
async def get_video(
    video_id: uuid.UUID,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Video)
        .where(Video.id == video_id, Video.deleted_at.is_(None))
        .options(selectinload(Video.artist))
    )
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found")

    media_root = await get_effective_media_path(db)
    app_data_root = await get_effective_app_data_path(db)
    transcoding_enabled = await get_effective_transcoding_enabled(db)
    return _video_to_read(
        video,
        video.artist.name if video.artist else "",
        media_root,
        app_data_root,
        transcoding_enabled,
        _user.id,
    )


async def _get_active_video(video_id: uuid.UUID, db: AsyncSession) -> Video:
    video = await db.scalar(select(Video).where(Video.id == video_id, Video.deleted_at.is_(None)))
    if not video:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found")
    return video


@router.post("/{video_id}/plays", response_model=VideoPlayRead, status_code=status.HTTP_201_CREATED)
async def record_video_play(
    video_id: uuid.UUID,
    body: VideoPlayCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    video = await _get_active_video(video_id, db)
    watched_seconds = max(0, int(round(body.watched_seconds)))
    duration = body.video_duration_seconds or video.duration
    threshold_ratio = await get_effective_view_threshold_ratio(db)
    counted_play = is_counted_view(
        watched_seconds=watched_seconds,
        video_duration_seconds=duration,
        threshold_ratio=threshold_ratio,
    )

    play = VideoPlay(
        video_id=video.id,
        user_id=user.id,
        watched_seconds=watched_seconds,
        video_duration_seconds=duration,
        counted_play=counted_play,
    )
    db.add(play)
    await db.commit()
    await db.refresh(play)
    return play


@router.get("/{video_id}/plays", response_model=VideoPlayStats)
async def get_video_play_stats(
    video_id: uuid.UUID,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ = await _get_active_video(video_id, db)

    play_count_result = await db.execute(
        select(func.count(VideoPlay.id)).where(
            VideoPlay.video_id == video_id,
            VideoPlay.counted_play.is_(True),
        )
    )
    play_count = play_count_result.scalar() or 0

    total_watched_result = await db.execute(
        select(func.coalesce(func.sum(VideoPlay.watched_seconds), 0)).where(
            VideoPlay.video_id == video_id
        )
    )
    total_watched_seconds = int(total_watched_result.scalar() or 0)

    history_result = await db.execute(
        select(VideoPlay)
        .where(VideoPlay.video_id == video_id)
        .order_by(VideoPlay.played_at.desc())
        .limit(50)
    )
    history = history_result.scalars().all()
    return VideoPlayStats(
        play_count=play_count,
        total_watched_seconds=total_watched_seconds,
        history=history,
    )


@router.patch("/{video_id}", response_model=VideoRead)
async def update_video(
    video_id: uuid.UUID,
    body: VideoUpdate,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Video)
        .where(Video.id == video_id, Video.deleted_at.is_(None))
        .options(selectinload(Video.artist))
    )
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(video, field, value)

    await db.commit()
    await db.refresh(video, ["artist"])
    media_root = await get_effective_media_path(db)
    app_data_root = await get_effective_app_data_path(db)
    transcoding_enabled = await get_effective_transcoding_enabled(db)
    return _video_to_read(
        video,
        video.artist.name if video.artist else "",
        media_root,
        app_data_root,
        transcoding_enabled,
        admin.id,
    )


@router.get("/transcode/status", response_model=TranscodeStatus)
async def get_transcode_status(
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Library-wide transcode coverage, plus any run currently in flight."""
    transcoding_enabled = await get_effective_transcoding_enabled(db)
    app_data_root = await get_effective_app_data_path(db)

    result = await db.execute(select(Video).where(Video.deleted_at.is_(None)))
    videos = result.scalars().all()

    needs_total = 0
    transcoded = 0
    for video in videos:
        if not needs_transcode(video.file_path):
            continue
        needs_total += 1
        playlist = (
            Path(app_data_root) / settings.HLS_DIR / str(video.id) / "index.m3u8"
        )
        if playlist_is_complete(playlist):
            transcoded += 1

    run = get_run().snapshot()
    return TranscodeStatus(
        transcoding_enabled=transcoding_enabled,
        total_videos=len(videos),
        needs_transcode=needs_total,
        transcoded=transcoded,
        pending=needs_total - transcoded,
        run=TranscodeRunStatus(**run),
    )


@router.post("/transcode/run", status_code=status.HTTP_202_ACCEPTED)
async def run_bulk_transcode(
    _admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Queue an HLS transcode for every video that still needs one."""
    if not await get_effective_transcoding_enabled(db):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Transcoding is disabled. Enable it in settings first.",
        )

    app_data_root = await get_effective_app_data_path(db)
    result = await db.execute(select(Video).where(Video.deleted_at.is_(None)))
    pending = [
        video
        for video in result.scalars().all()
        if needs_transcode(video.file_path)
        and not playlist_is_complete(
            Path(app_data_root) / settings.HLS_DIR / str(video.id) / "index.m3u8"
        )
    ]

    if not pending:
        return {"message": "Nothing to transcode", "queued": 0}

    run = get_run()
    if not run.start(len(pending)):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A transcode run is already in progress.",
        )

    queued = 0
    try:
        for video in pending:
            submit_job(
                "bulk_hls",
                transcode_one_and_report,
                str(video.id),
                video.title,
            )
            queued += 1
    except Exception:
        # Some jobs may already be running and will report in; only abandon the
        # run outright if nothing was queued at all.
        if queued == 0:
            run.abandon()
        raise

    return {"message": "Transcoding queued", "queued": queued}


@router.post("/transcode/cancel", status_code=status.HTTP_202_ACCEPTED)
async def cancel_bulk_transcode(
    _admin: User = Depends(get_current_admin),
):
    """Stop the current transcode run.

    Queued videos are dropped and the encode in progress is killed, with its
    partial output discarded so it counts as untranscoded again rather than
    being served as a seekless stream.
    """
    if not get_run().request_cancel():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No transcode run is in progress.",
        )
    return {"message": "Cancelling transcode run"}


@router.post("/{video_id}/hls", status_code=status.HTTP_202_ACCEPTED)
async def queue_hls_generation(
    video_id: uuid.UUID,
    _admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    _ = await _get_active_video(video_id, db)
    task_id = submit_job("hls_generation", generate_hls_for_video, str(video_id))
    return {"message": "HLS generation queued", "task_id": task_id}


async def _discard_assets(
    doomed: list[tuple[uuid.UUID, str | None, str | None]],
    app_data_root: str,
) -> None:
    """Delete the generated files for videos that have just been removed.

    Runs after the commit: the row change is what the user asked for, and losing
    it because a stale thumbnail could not be unlinked would be the wrong
    trade. Off the event loop because removing an HLS directory is real disk
    work, not a metadata update.
    """
    for video_id, thumbnail_path, preview_path in doomed:
        await asyncio.to_thread(
            delete_video_assets,
            video_id,
            thumbnail_path,
            preview_path,
            app_data_root,
        )


async def _cleanup_empty_artists(artist_ids: set[uuid.UUID], db: AsyncSession):
    """Soft-delete artists that have zero active videos remaining."""
    await db.flush()  # ensure pending deletes are visible to count queries
    for artist_id in artist_ids:
        count_result = await db.execute(
            select(func.count(Video.id)).where(Video.artist_id == artist_id, Video.deleted_at.is_(None))
        )
        if (count_result.scalar() or 0) == 0:
            artist_result = await db.execute(
                select(Artist).where(Artist.id == artist_id, Artist.deleted_at.is_(None))
            )
            artist = artist_result.scalar_one_or_none()
            if artist:
                artist.deleted_at = datetime.now(timezone.utc)


@router.post("/bulk-delete", status_code=status.HTTP_204_NO_CONTENT)
async def bulk_delete_videos(
    body: VideoBulkDelete,
    _admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Video).where(Video.id.in_(body.video_ids), Video.deleted_at.is_(None)))
    videos = result.scalars().all()
    if not videos:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No videos found")

    app_data_root = await get_effective_app_data_path(db)
    artist_ids: set[uuid.UUID] = set()
    now = datetime.now(timezone.utc)
    doomed = [
        (video.id, video.thumbnail_path, video.preview_path) for video in videos
    ]
    for video in videos:
        artist_ids.add(video.artist_id)
        video.deleted_at = now
        video.thumbnail_path = None
        video.preview_path = None

    await _cleanup_empty_artists(artist_ids, db)
    await db.commit()
    await _discard_assets(doomed, app_data_root)


@router.delete("/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_video(
    video_id: uuid.UUID,
    _admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Video).where(Video.id == video_id, Video.deleted_at.is_(None)))
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found")

    app_data_root = await get_effective_app_data_path(db)
    artist_id = video.artist_id
    doomed = [(video.id, video.thumbnail_path, video.preview_path)]
    video.deleted_at = datetime.now(timezone.utc)
    video.thumbnail_path = None
    video.preview_path = None
    await _cleanup_empty_artists({artist_id}, db)
    await db.commit()
    await _discard_assets(doomed, app_data_root)
