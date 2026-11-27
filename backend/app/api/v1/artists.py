import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_admin, get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.uploads import read_upload_limited
from app.models.artist import Artist
from app.models.playback import VideoPlay
from app.models.user import User
from app.models.video import Video
from app.schemas.artist import (
    ArtistDetailRead,
    LastfmArtistApplyRequest,
    LastfmArtistSearchItem,
    SpotifyArtistApplyRequest,
    SpotifyArtistSearchItem,
    ArtistRead,
    ArtistRecommendationRead,
    ArtistRecommendationsPage,
    ArtistUpdate,
    WikipediaArticleApplyRequest,
    WikipediaArticleSearchItem,
)
from app.schemas.video import VideoRead
from app.services.lastfm import (
    LASTFM_PRO_REQUIRED_MESSAGE,
    lastfm_key_refused,
    fetch_similar_artists,
    normalize_for_match,
    parse_lastfm_artist_url,
    search_artists,
)
from app.services.artist_metadata import fetch_artist_metadata
from app.services.path_urls import is_external_url, to_public_asset_url
from app.services.runtime_settings import (
    get_effective_app_data_path,
    get_effective_artist_bio_sources,
    get_effective_artist_image_sources,
    get_effective_lastfm_override_local_artist_images,
    get_effective_media_path,
    get_effective_transcoding_enabled,
    spotify_configured,
)
from app.services.spotify import (
    SpotifyServiceError,
    find_artist_image_url,
    get_artist as get_spotify_artist,
    parse_spotify_artist_id,
    search_artists as search_spotify_artists,
)
from app.services.stream_tokens import sign_stream_url_for_user
from app.services.wikipedia import fetch_article, parse_wikipedia_url, search_articles

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/artists", tags=["artists"])
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
ARTIST_IMAGE_DIR_NAME = ".artist-images"


def _remove_stored_artist_image(image_path: str, app_data_root: str) -> None:
    """Delete an uploaded artist image, ignoring anything outside our own store.

    The path comes from the database and is only ever written by the upload
    endpoint, but it is checked rather than trusted: this deletes files, and a
    row that somehow pointed elsewhere must not be able to aim it.
    """
    target = Path(image_path)
    store = Path(app_data_root) / ARTIST_IMAGE_DIR_NAME
    try:
        target.resolve(strict=False).relative_to(store.resolve(strict=False))
    except ValueError:
        logger.warning("Refusing to delete artist image outside %s: %s", store, target)
        return
    try:
        target.unlink(missing_ok=True)
    except OSError:
        logger.warning("Could not delete artist image %s", target, exc_info=True)


def _asset_url(
    abs_path_or_url: str | None,
    media_root: str,
    app_data_root: str,
    *,
    cache_bust: bool = False,
    user_id: uuid.UUID | None = None,
) -> str | None:
    signer = None
    if user_id is not None:
        signer = lambda url: sign_stream_url_for_user(url, user_id) or url
    return to_public_asset_url(
        abs_path_or_url,
        media_root=media_root,
        app_data_root=app_data_root,
        cache_bust=cache_bust,
        signer=signer,
    )


# (spotify enabled, spotify ranked first, uploads may be overridden)
ArtistImageDisplay = tuple[bool, bool, bool]


async def _artist_image_display(db: AsyncSession) -> ArtistImageDisplay:
    sources = await get_effective_artist_image_sources(db)
    return (
        "spotify" in sources and spotify_configured(),
        bool(sources) and sources[0] == "spotify",
        await get_effective_lastfm_override_local_artist_images(db),
    )


def _artist_image_url(
    artist: Artist,
    media_root: str,
    app_data_root: str,
    user_id: uuid.UUID,
    display: ArtistImageDisplay,
) -> str | None:
    """Public image URL for an artist, honouring the image source priority.

    Spotify images are never stored, so when Spotify should win the URL points
    at a redirect that looks the image up at view time. Spotify wins when it is
    ranked first (over an upload only if uploads may be overridden), or when
    it is enabled at all and nothing is stored.
    """
    stored = _asset_url(artist.image_path, media_root, app_data_root, cache_bust=True, user_id=user_id)
    spotify, spotify_first, override_local = display
    if spotify and (
        stored is None
        or (spotify_first and (override_local or is_external_url(artist.image_path)))
    ):
        # The pin is in the URL so browsers drop their cached redirect when it changes.
        return f"/api/v1/artists/{artist.id}/spotify-image?v={artist.spotify_artist_id or 'name'}"
    return stored


async def _fetch_metadata(
    db: AsyncSession,
    artist: Artist,
    *,
    lastfm_name: str | None,
    wikipedia_url: str | None,
    bio_sources: list[str] | None = None,
) -> dict | None:
    return await asyncio.to_thread(
        fetch_artist_metadata,
        artist.name.strip(),
        lastfm_name=lastfm_name,
        wikipedia_url=wikipedia_url,
        lastfm_api_key=settings.LASTFM_API_KEY.strip(),
        bio_sources=bio_sources if bio_sources is not None else await get_effective_artist_bio_sources(db),
        image_sources=await get_effective_artist_image_sources(db),
    )


def _apply_metadata(artist: Artist, info: dict, override_local_images: bool) -> None:
    if info.get("bio"):
        artist.bio = info["bio"]
    image_url = info.get("image_url")
    if image_url and (
        override_local_images or not artist.image_path or is_external_url(artist.image_path)
    ):
        artist.image_path = image_url
    artist.lastfm_artist_name = info.get("lastfm_artist_name") or artist.lastfm_artist_name
    artist.wikipedia_url = info.get("wikipedia_url") or artist.wikipedia_url
    artist.lastfm_fetched_at = datetime.now(timezone.utc)


def _hls_playlist_url(
    video_id: uuid.UUID,
    app_data_root: str,
    user_id: uuid.UUID | None = None,
) -> str | None:
    playlist = Path(app_data_root) / settings.HLS_DIR / str(video_id) / "index.m3u8"
    if not playlist.exists():
        return None
    url = f"/data/{settings.HLS_DIR}/{video_id}/index.m3u8"
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
    video_url = _asset_url(video.file_path, media_root, app_data_root, user_id=user_id)
    hls_url = (
        _hls_playlist_url(video.id, app_data_root, user_id=user_id) if transcoding_enabled else None
    )
    return VideoRead(
        id=video.id,
        title=video.title,
        artist_id=video.artist_id,
        artist_name=artist_name,
        album=video.album,
        duration=video.duration,
        thumbnail_url=_asset_url(video.thumbnail_path, media_root, app_data_root, user_id=user_id),
        preview_url=_asset_url(video.preview_path, media_root, app_data_root, user_id=user_id),
        video_url=video_url,
        playback_url=hls_url or video_url,
        year=video.year,
        genre=video.genre,
        file_size=video.file_size,
        added_at=video.added_at,
    )


@router.get("/", response_model=list[ArtistRead])
async def list_artists(
    skip: int = Query(0, ge=0),
    # Artists are one small row each and the A-Z index needs all of them at once
    # to know which letters exist, so this is deliberately high rather than
    # paged. The old ceiling of 200 silently truncated larger libraries.
    limit: int = Query(500, ge=1, le=5000),
    search: str | None = Query(None, max_length=200),
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(
            Artist,
            func.count(Video.id).label("video_count"),
        )
        .outerjoin(Video, (Video.artist_id == Artist.id) & Video.deleted_at.is_(None))
        .where(Artist.deleted_at.is_(None))
    )
    if search:
        query = query.where(Artist.name.ilike(f"%{search}%"))
    query = query.group_by(Artist.id).order_by(Artist.name).offset(skip).limit(limit)

    result = await db.execute(query)
    rows = result.all()
    media_root = await get_effective_media_path(db)
    image_display = await _artist_image_display(db)
    app_data_root = await get_effective_app_data_path(db)
    return [
        ArtistRead(
            id=artist.id,
            name=artist.name,
            lastfm_artist_name=artist.lastfm_artist_name,
            wikipedia_url=artist.wikipedia_url,
            spotify_artist_id=artist.spotify_artist_id,
            bio=artist.bio,
            image_url=_artist_image_url(artist, media_root, app_data_root, _user.id, image_display),
            video_count=count,
            created_at=artist.created_at,
        )
        for artist, count in rows
    ]


def _raise_if_lastfm_key_refused() -> None:
    if lastfm_key_refused():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=LASTFM_PRO_REQUIRED_MESSAGE,
        )


@router.get("/lastfm/search", response_model=list[LastfmArtistSearchItem])
async def search_lastfm_artists(
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(10, ge=1, le=20),
    _admin: User = Depends(get_current_admin),
):
    api_key = settings.LASTFM_API_KEY.strip()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Last.fm integration is not configured on the server",
        )
    results = await asyncio.to_thread(search_artists, q, api_key, limit=limit)
    if not results:
        _raise_if_lastfm_key_refused()
    return [
        LastfmArtistSearchItem(
            name=item.get("name", ""),
            image_url=item.get("image_url"),
            url=item.get("url"),
        )
        for item in results
        if item.get("name")
    ]


@router.get("/wikipedia/search", response_model=list[WikipediaArticleSearchItem])
async def search_wikipedia_articles(
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(10, ge=1, le=20),
    _admin: User = Depends(get_current_admin),
):
    results = await asyncio.to_thread(search_articles, q, limit=limit)
    return [WikipediaArticleSearchItem(**item) for item in results]


@router.post("/{artist_id}/wikipedia/apply", response_model=ArtistRead)
async def apply_wikipedia_article(
    artist_id: uuid.UUID,
    body: WikipediaArticleApplyRequest,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Use a specific Wikipedia article (picked from search or pasted) for the bio."""
    artist = await db.scalar(
        select(Artist).where(Artist.id == artist_id, Artist.deleted_at.is_(None))
    )
    if not artist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artist not found")
    if not parse_wikipedia_url(body.wikipedia_url):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "That does not look like a Wikipedia article link. Expected "
                "something like https://en.wikipedia.org/wiki/Artist_Name"
            ),
        )
    article = await asyncio.to_thread(fetch_article, body.wikipedia_url)
    if not article or not article.get("bio"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No usable article found at that link (missing, empty or a disambiguation page)",
        )

    # The admin picked this article, so the bio comes from it; images still
    # follow the configured priority.
    info = await _fetch_metadata(
        db,
        artist,
        lastfm_name=artist.lastfm_artist_name,
        wikipedia_url=article["url"],
        bio_sources=["wikipedia"],
    )
    override_local_images = await get_effective_lastfm_override_local_artist_images(db)
    _apply_metadata(artist, info or article, override_local_images)
    artist.wikipedia_url = article["url"]
    await db.commit()
    await db.refresh(artist)

    count_result = await db.execute(
        select(func.count(Video.id)).where(Video.artist_id == artist.id, Video.deleted_at.is_(None))
    )
    media_root = await get_effective_media_path(db)
    image_display = await _artist_image_display(db)
    app_data_root = await get_effective_app_data_path(db)
    return ArtistRead(
        id=artist.id,
        name=artist.name,
        lastfm_artist_name=artist.lastfm_artist_name,
        wikipedia_url=artist.wikipedia_url,
        spotify_artist_id=artist.spotify_artist_id,
        bio=artist.bio,
        image_url=_artist_image_url(artist, media_root, app_data_root, admin.id, image_display),
        video_count=count_result.scalar() or 0,
        created_at=artist.created_at,
    )


def _require_spotify() -> None:
    if not spotify_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Spotify integration is not configured on the server",
        )


@router.get("/spotify/search", response_model=list[SpotifyArtistSearchItem])
async def search_spotify_artist_matches(
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(10, ge=1, le=20),
    _admin: User = Depends(get_current_admin),
):
    _require_spotify()
    try:
        results = await search_spotify_artists(q, limit=limit)
    except SpotifyServiceError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return [SpotifyArtistSearchItem(**item) for item in results]


@router.post("/{artist_id}/spotify/apply", response_model=ArtistRead)
async def apply_spotify_artist(
    artist_id: uuid.UUID,
    body: SpotifyArtistApplyRequest,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Pin the Spotify artist whose image is displayed, or clear the pin."""
    artist = await db.scalar(
        select(Artist).where(Artist.id == artist_id, Artist.deleted_at.is_(None))
    )
    if not artist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artist not found")

    raw = (body.spotify_artist or "").strip()
    if raw:
        _require_spotify()
        spotify_id = parse_spotify_artist_id(raw)
        if not spotify_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "That does not look like a Spotify artist link. Expected "
                    "something like https://open.spotify.com/artist/..."
                ),
            )
        try:
            await get_spotify_artist(spotify_id)  # confirms it exists
        except SpotifyServiceError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Spotify could not find that artist",
            ) from exc
        artist.spotify_artist_id = spotify_id
    else:
        artist.spotify_artist_id = None
    await db.commit()
    await db.refresh(artist)

    count_result = await db.execute(
        select(func.count(Video.id)).where(Video.artist_id == artist.id, Video.deleted_at.is_(None))
    )
    media_root = await get_effective_media_path(db)
    image_display = await _artist_image_display(db)
    app_data_root = await get_effective_app_data_path(db)
    return ArtistRead(
        id=artist.id,
        name=artist.name,
        lastfm_artist_name=artist.lastfm_artist_name,
        wikipedia_url=artist.wikipedia_url,
        spotify_artist_id=artist.spotify_artist_id,
        bio=artist.bio,
        image_url=_artist_image_url(artist, media_root, app_data_root, admin.id, image_display),
        video_count=count_result.scalar() or 0,
        created_at=artist.created_at,
    )


@router.get("/{artist_id}/spotify-image", include_in_schema=False)
async def artist_spotify_image(
    artist_id: uuid.UUID,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Redirect to the artist's Spotify image, looked up at view time.

    Spotify images are displayed but never stored. Falls back to the stored
    image, then a placeholder, so an <img> pointing here always resolves.
    """
    artist = await db.scalar(
        select(Artist).where(Artist.id == artist_id, Artist.deleted_at.is_(None))
    )
    if not artist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artist not found")
    url = None
    if spotify_configured():
        try:
            url = await find_artist_image_url(artist.name, artist.spotify_artist_id)
        except SpotifyServiceError as exc:
            logger.warning("Spotify artist image lookup failed for %s: %s", artist.name, exc)
    if not url:
        url = _asset_url(
            artist.image_path,
            await get_effective_media_path(db),
            await get_effective_app_data_path(db),
            cache_bust=True,
            user_id=_user.id,
        ) or "/placeholder.svg"
    return RedirectResponse(url, status_code=status.HTTP_302_FOUND, headers={"Cache-Control": "private, max-age=3600"})


@router.post("/{artist_id}/lastfm/apply", response_model=ArtistRead)
async def apply_lastfm_artist_match(
    artist_id: uuid.UUID,
    body: LastfmArtistApplyRequest,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Artist).where(Artist.id == artist_id, Artist.deleted_at.is_(None))
    )
    artist = result.scalar_one_or_none()
    if not artist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artist not found")

    api_key = settings.LASTFM_API_KEY.strip()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Last.fm integration is not configured on the server",
        )

    if (body.lastfm_url or "").strip():
        chosen_name = parse_lastfm_artist_url(body.lastfm_url or "") or ""
        if not chosen_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "That does not look like a Last.fm artist link. Expected "
                    "something like https://www.last.fm/music/Artist Name"
                ),
            )
    else:
        chosen_name = (body.lastfm_artist_name or "").strip()
    if not chosen_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Last.fm artist name is required",
        )

    # The admin picked Last.fm, so the bio comes from it; images still follow
    # the configured priority.
    info = await _fetch_metadata(
        db, artist, lastfm_name=chosen_name, wikipedia_url=artist.wikipedia_url, bio_sources=["lastfm"]
    )
    if not info:
        _raise_if_lastfm_key_refused()
    override_local_images = await get_effective_lastfm_override_local_artist_images(db)
    artist.lastfm_artist_name = chosen_name
    if info:
        _apply_metadata(artist, info, override_local_images)

    await db.commit()
    await db.refresh(artist)

    count_result = await db.execute(
        select(func.count(Video.id)).where(Video.artist_id == artist.id, Video.deleted_at.is_(None))
    )
    video_count = count_result.scalar() or 0
    media_root = await get_effective_media_path(db)
    image_display = await _artist_image_display(db)
    app_data_root = await get_effective_app_data_path(db)
    return ArtistRead(
        id=artist.id,
        name=artist.name,
        lastfm_artist_name=artist.lastfm_artist_name,
        wikipedia_url=artist.wikipedia_url,
        spotify_artist_id=artist.spotify_artist_id,
        bio=artist.bio,
        image_url=_artist_image_url(artist, media_root, app_data_root, admin.id, image_display),
        video_count=video_count,
        created_at=artist.created_at,
    )


@router.get("/{artist_id}", response_model=ArtistDetailRead)
async def get_artist(
    artist_id: uuid.UUID,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Artist)
        .where(Artist.id == artist_id, Artist.deleted_at.is_(None))
        .options(selectinload(Artist.videos))
    )
    artist = result.scalar_one_or_none()
    if not artist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artist not found")

    media_root = await get_effective_media_path(db)
    image_display = await _artist_image_display(db)
    app_data_root = await get_effective_app_data_path(db)
    transcoding_enabled = await get_effective_transcoding_enabled(db)
    active_videos = [v for v in artist.videos if v.deleted_at is None]
    play_count_result = await db.execute(
        select(func.count(VideoPlay.id))
        .join(Video, VideoPlay.video_id == Video.id)
        .where(
            Video.artist_id == artist.id,
            Video.deleted_at.is_(None),
            VideoPlay.counted_play.is_(True),
        )
    )
    play_count = play_count_result.scalar() or 0
    return ArtistDetailRead(
        id=artist.id,
        name=artist.name,
        lastfm_artist_name=artist.lastfm_artist_name,
        wikipedia_url=artist.wikipedia_url,
        spotify_artist_id=artist.spotify_artist_id,
        bio=artist.bio,
        image_url=_artist_image_url(artist, media_root, app_data_root, _user.id, image_display),
        video_count=len(active_videos),
        play_count=play_count,
        created_at=artist.created_at,
        videos=[
            _video_to_read(
                v,
                artist.name,
                media_root,
                app_data_root,
                transcoding_enabled,
                _user.id,
            )
            for v in active_videos
        ],
    )


@router.get("/{artist_id}/recommendations", response_model=ArtistRecommendationsPage)
async def get_artist_recommendations(
    artist_id: uuid.UUID,
    offset: int = Query(0, ge=0),
    limit: int = Query(12, ge=1, le=50),
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    artist = await db.scalar(
        select(Artist).where(Artist.id == artist_id, Artist.deleted_at.is_(None))
    )
    if not artist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artist not found")

    api_key = settings.LASTFM_API_KEY.strip()
    if not api_key:
        return ArtistRecommendationsPage(items=[], offset=offset, limit=limit, has_more=False)

    fetch_limit = max(50, min(200, (offset + limit) * 4))
    similar = await asyncio.to_thread(
        fetch_similar_artists,
        artist.name,
        api_key,
        limit=fetch_limit,
    )
    if not similar:
        return ArtistRecommendationsPage(
            items=[],
            offset=offset,
            limit=limit,
            has_more=False,
            notice=LASTFM_PRO_REQUIRED_MESSAGE if lastfm_key_refused() else None,
        )

    library_artists = (
        await db.execute(select(Artist).where(Artist.deleted_at.is_(None)))
    ).scalars().all()
    by_normalized_name: dict[str, Artist] = {}
    for row in library_artists:
        normalized = normalize_for_match(row.name)
        if normalized and normalized not in by_normalized_name:
            by_normalized_name[normalized] = row

    matched: list[tuple[Artist, float | None]] = []
    seen_ids: set[uuid.UUID] = set()
    for rec in similar:
        normalized = normalize_for_match(rec.get("name"))
        if not normalized:
            continue
        matched_artist = by_normalized_name.get(normalized)
        if not matched_artist:
            continue
        if matched_artist.id == artist.id or matched_artist.id in seen_ids:
            continue
        seen_ids.add(matched_artist.id)
        matched.append((matched_artist, rec.get("match")))

    total = len(matched)
    page = matched[offset : offset + limit]
    page_artist_ids = [row.id for row, _ in page]

    video_count_map: dict[uuid.UUID, int] = {}
    if page_artist_ids:
        count_rows = (
            await db.execute(
                select(Video.artist_id, func.count(Video.id))
                .where(
                    Video.deleted_at.is_(None),
                    Video.artist_id.in_(page_artist_ids),
                )
                .group_by(Video.artist_id)
            )
        ).all()
        video_count_map = {artist_id: int(count) for artist_id, count in count_rows}

    media_root = await get_effective_media_path(db)
    image_display = await _artist_image_display(db)
    app_data_root = await get_effective_app_data_path(db)
    items = [
        ArtistRecommendationRead(
            id=row.id,
            name=row.name,
            lastfm_artist_name=row.lastfm_artist_name,
            wikipedia_url=row.wikipedia_url,
            spotify_artist_id=row.spotify_artist_id,
            bio=row.bio,
            image_url=_artist_image_url(row, media_root, app_data_root, _user.id, image_display),
            video_count=video_count_map.get(row.id, 0),
            play_count=0,
            created_at=row.created_at,
            lastfm_match=score,
        )
        for row, score in page
    ]

    return ArtistRecommendationsPage(
        items=items,
        offset=offset,
        limit=limit,
        has_more=offset + limit < total,
    )


@router.patch("/{artist_id}", response_model=ArtistRead)
async def update_artist(
    artist_id: uuid.UUID,
    body: ArtistUpdate,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Artist).where(Artist.id == artist_id, Artist.deleted_at.is_(None)))
    artist = result.scalar_one_or_none()
    if not artist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artist not found")

    update_data = body.model_dump(exclude_unset=True)
    image_url = update_data.pop("image_url", None) if "image_url" in update_data else None
    for field, value in update_data.items():
        setattr(artist, field, value)
    if image_url is not None:
        if image_url and not is_external_url(image_url):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Artist image URL must be an http(s) URL",
            )
        artist.image_path = image_url or None

    await db.commit()
    await db.refresh(artist)

    count_result = await db.execute(
        select(func.count(Video.id)).where(Video.artist_id == artist.id, Video.deleted_at.is_(None))
    )
    video_count = count_result.scalar() or 0
    media_root = await get_effective_media_path(db)
    image_display = await _artist_image_display(db)
    app_data_root = await get_effective_app_data_path(db)

    return ArtistRead(
        id=artist.id,
        name=artist.name,
        lastfm_artist_name=artist.lastfm_artist_name,
        wikipedia_url=artist.wikipedia_url,
        spotify_artist_id=artist.spotify_artist_id,
        bio=artist.bio,
        image_url=_artist_image_url(artist, media_root, app_data_root, admin.id, image_display),
        video_count=video_count,
        created_at=artist.created_at,
    )


@router.post("/{artist_id}/refresh-metadata", response_model=ArtistRead)
async def refresh_artist_metadata(
    artist_id: uuid.UUID,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Artist).where(Artist.id == artist_id, Artist.deleted_at.is_(None))
    )
    artist = result.scalar_one_or_none()
    if not artist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artist not found")

    info = await _fetch_metadata(
        db, artist, lastfm_name=artist.lastfm_artist_name, wikipedia_url=artist.wikipedia_url
    )
    if not info:
        _raise_if_lastfm_key_refused()
    override_local_images = await get_effective_lastfm_override_local_artist_images(db)
    if info:
        _apply_metadata(artist, info, override_local_images)
        await db.commit()
        await db.refresh(artist)

    count_result = await db.execute(
        select(func.count(Video.id)).where(Video.artist_id == artist.id, Video.deleted_at.is_(None))
    )
    video_count = count_result.scalar() or 0
    media_root = await get_effective_media_path(db)
    image_display = await _artist_image_display(db)
    app_data_root = await get_effective_app_data_path(db)

    return ArtistRead(
        id=artist.id,
        name=artist.name,
        lastfm_artist_name=artist.lastfm_artist_name,
        wikipedia_url=artist.wikipedia_url,
        spotify_artist_id=artist.spotify_artist_id,
        bio=artist.bio,
        image_url=_artist_image_url(artist, media_root, app_data_root, admin.id, image_display),
        video_count=video_count,
        created_at=artist.created_at,
    )


@router.post("/{artist_id}/reset-metadata", response_model=ArtistRead)
async def reset_artist_metadata(
    artist_id: uuid.UUID,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Discard local bio/image edits and pull the artist fresh from the configured sources.

    Distinct from refresh-metadata, which keeps whatever Last.fm name and
    Wikipedia article were previously chosen and only fills gaps. Reset throws that choice away too and
    looks the artist up by folder name again, which is the way back when a wrong
    match has been applied. An uploaded image is deleted rather than orphaned.

    Clearing happens even when the sources are unavailable -- a reset that silently
    did nothing because the network was down would be worse than an empty bio.
    """
    result = await db.execute(
        select(Artist).where(Artist.id == artist_id, Artist.deleted_at.is_(None))
    )
    artist = result.scalar_one_or_none()
    if not artist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artist not found")

    app_data_root = await get_effective_app_data_path(db)
    previous_image = artist.image_path

    artist.bio = None
    artist.image_path = None
    artist.lastfm_artist_name = None
    artist.wikipedia_url = None
    artist.spotify_artist_id = None
    artist.lastfm_fetched_at = None

    info = await _fetch_metadata(db, artist, lastfm_name=None, wikipedia_url=None)
    refreshed = info is not None
    if info:
        _apply_metadata(artist, info, override_local_images=True)

    await db.commit()
    await db.refresh(artist)

    # Only once the row no longer references it, and only for a file we stored.
    if previous_image and not is_external_url(previous_image):
        await asyncio.to_thread(_remove_stored_artist_image, previous_image, app_data_root)

    logger.info(
        "Reset metadata for artist %s (refreshed=%s)", artist.name, refreshed
    )

    count_result = await db.execute(
        select(func.count(Video.id)).where(Video.artist_id == artist.id, Video.deleted_at.is_(None))
    )
    video_count = count_result.scalar() or 0
    media_root = await get_effective_media_path(db)
    image_display = await _artist_image_display(db)

    return ArtistRead(
        id=artist.id,
        name=artist.name,
        lastfm_artist_name=artist.lastfm_artist_name,
        wikipedia_url=artist.wikipedia_url,
        spotify_artist_id=artist.spotify_artist_id,
        bio=artist.bio,
        image_url=_artist_image_url(artist, media_root, app_data_root, admin.id, image_display),
        video_count=video_count,
        created_at=artist.created_at,
    )


@router.delete("/{artist_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_artist(
    artist_id: uuid.UUID,
    _admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Artist).where(Artist.id == artist_id, Artist.deleted_at.is_(None)))
    artist = result.scalar_one_or_none()
    if not artist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artist not found")

    artist.deleted_at = datetime.now(timezone.utc)
    await db.commit()


@router.put("/{artist_id}/image", response_model=ArtistRead)
async def upload_artist_image(
    artist_id: uuid.UUID,
    file: UploadFile,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="File must be an image"
        )

    result = await db.execute(select(Artist).where(Artist.id == artist_id, Artist.deleted_at.is_(None)))
    artist = result.scalar_one_or_none()
    if not artist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artist not found")

    media_root = await get_effective_media_path(db)
    image_display = await _artist_image_display(db)
    app_data_root = await get_effective_app_data_path(db)
    ext = (os.path.splitext(file.filename or "img.jpg")[1] or ".jpg").lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        ext = ".jpg"
    image_dir = os.path.join(app_data_root, ARTIST_IMAGE_DIR_NAME)
    os.makedirs(image_dir, exist_ok=True)
    image_path = os.path.join(image_dir, f"{artist.id}{ext}")

    content = await read_upload_limited(
        file,
        settings.MAX_IMAGE_UPLOAD_BYTES,
        "Image file is too large",
    )
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Image file is empty",
        )
    with open(image_path, "wb") as f:
        f.write(content)

    artist.image_path = image_path
    await db.commit()
    await db.refresh(artist)

    count_result = await db.execute(
        select(func.count(Video.id)).where(Video.artist_id == artist.id, Video.deleted_at.is_(None))
    )
    video_count = count_result.scalar() or 0

    return ArtistRead(
        id=artist.id,
        name=artist.name,
        lastfm_artist_name=artist.lastfm_artist_name,
        wikipedia_url=artist.wikipedia_url,
        spotify_artist_id=artist.spotify_artist_id,
        bio=artist.bio,
        image_url=_artist_image_url(artist, media_root, app_data_root, admin.id, image_display),
        video_count=video_count,
        created_at=artist.created_at,
    )
