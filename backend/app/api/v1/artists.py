import asyncio
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
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
    ArtistRead,
    ArtistRecommendationRead,
    ArtistRecommendationsPage,
    ArtistUpdate,
)
from app.schemas.video import VideoRead
from app.services.lastfm import (
    fetch_artist_info,
    fetch_similar_artists,
    normalize_for_match,
    search_artists,
)
from app.services.path_urls import is_external_url, to_public_asset_url
from app.services.runtime_settings import (
    get_effective_app_data_path,
    get_effective_lastfm_override_local_artist_images,
    get_effective_media_path,
    get_effective_transcoding_enabled,
)
from app.services.stream_tokens import sign_stream_url_for_user

router = APIRouter(prefix="/artists", tags=["artists"])
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


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
    limit: int = Query(50, ge=1, le=200),
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
    app_data_root = await get_effective_app_data_path(db)
    return [
        ArtistRead(
            id=artist.id,
            name=artist.name,
            lastfm_artist_name=artist.lastfm_artist_name,
            bio=artist.bio,
            image_url=_asset_url(
                artist.image_path,
                media_root,
                app_data_root,
                cache_bust=True,
                user_id=_user.id,
            ),
            video_count=count,
            created_at=artist.created_at,
        )
        for artist, count in rows
    ]


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
    return [
        LastfmArtistSearchItem(
            name=item.get("name", ""),
            image_url=item.get("image_url"),
            url=item.get("url"),
        )
        for item in results
        if item.get("name")
    ]


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

    chosen_name = body.lastfm_artist_name.strip()
    if not chosen_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Last.fm artist name is required",
        )

    info = await asyncio.to_thread(fetch_artist_info, chosen_name, api_key)
    override_local_images = await get_effective_lastfm_override_local_artist_images(db)
    artist.lastfm_artist_name = chosen_name
    if info:
        fetched_bio = info.get("bio")
        fetched_image_url = info.get("image_url")
        canonical_name = (info.get("artist_name") or chosen_name).strip()
        artist.lastfm_artist_name = canonical_name
        if fetched_bio:
            artist.bio = fetched_bio
        if fetched_image_url and (
            override_local_images
            or not artist.image_path
            or is_external_url(artist.image_path)
        ):
            artist.image_path = fetched_image_url
        artist.lastfm_fetched_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(artist)

    count_result = await db.execute(
        select(func.count(Video.id)).where(Video.artist_id == artist.id, Video.deleted_at.is_(None))
    )
    video_count = count_result.scalar() or 0
    media_root = await get_effective_media_path(db)
    app_data_root = await get_effective_app_data_path(db)
    return ArtistRead(
        id=artist.id,
        name=artist.name,
        lastfm_artist_name=artist.lastfm_artist_name,
        bio=artist.bio,
        image_url=_asset_url(
            artist.image_path,
            media_root,
            app_data_root,
            cache_bust=True,
            user_id=admin.id,
        ),
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
        bio=artist.bio,
        image_url=_asset_url(
            artist.image_path,
            media_root,
            app_data_root,
            cache_bust=True,
            user_id=_user.id,
        ),
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
        return ArtistRecommendationsPage(items=[], offset=offset, limit=limit, has_more=False)

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
    app_data_root = await get_effective_app_data_path(db)
    items = [
        ArtistRecommendationRead(
            id=row.id,
            name=row.name,
            lastfm_artist_name=row.lastfm_artist_name,
            bio=row.bio,
            image_url=_asset_url(
                row.image_path,
                media_root,
                app_data_root,
                cache_bust=True,
                user_id=_user.id,
            ),
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
    app_data_root = await get_effective_app_data_path(db)

    return ArtistRead(
        id=artist.id,
        name=artist.name,
        lastfm_artist_name=artist.lastfm_artist_name,
        bio=artist.bio,
        image_url=_asset_url(
            artist.image_path,
            media_root,
            app_data_root,
            cache_bust=True,
            user_id=admin.id,
        ),
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

    api_key = settings.LASTFM_API_KEY.strip()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Last.fm integration is not configured on the server",
        )

    target_lastfm_name = (artist.lastfm_artist_name or artist.name).strip()
    info = await asyncio.to_thread(fetch_artist_info, target_lastfm_name, api_key)
    override_local_images = await get_effective_lastfm_override_local_artist_images(db)
    if info:
        fetched_bio = info.get("bio")
        fetched_image_url = info.get("image_url")
        canonical_name = (info.get("artist_name") or target_lastfm_name).strip()
        artist.lastfm_artist_name = canonical_name
        if fetched_bio:
            artist.bio = fetched_bio
        if fetched_image_url and (
            override_local_images
            or not artist.image_path
            or is_external_url(artist.image_path)
        ):
            artist.image_path = fetched_image_url
        artist.lastfm_fetched_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(artist)

    count_result = await db.execute(
        select(func.count(Video.id)).where(Video.artist_id == artist.id, Video.deleted_at.is_(None))
    )
    video_count = count_result.scalar() or 0
    media_root = await get_effective_media_path(db)
    app_data_root = await get_effective_app_data_path(db)

    return ArtistRead(
        id=artist.id,
        name=artist.name,
        lastfm_artist_name=artist.lastfm_artist_name,
        bio=artist.bio,
        image_url=_asset_url(
            artist.image_path,
            media_root,
            app_data_root,
            cache_bust=True,
            user_id=admin.id,
        ),
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
    app_data_root = await get_effective_app_data_path(db)
    ext = (os.path.splitext(file.filename or "img.jpg")[1] or ".jpg").lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        ext = ".jpg"
    image_dir = os.path.join(app_data_root, ".artist-images")
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
        bio=artist.bio,
        image_url=_asset_url(
            artist.image_path,
            media_root,
            app_data_root,
            cache_bust=True,
            user_id=admin.id,
        ),
        video_count=video_count,
        created_at=artist.created_at,
    )
