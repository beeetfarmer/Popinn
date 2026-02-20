import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_admin
from app.core.config import settings
from app.core.database import get_db
from app.models.artist import Artist
from app.models.user import User
from app.models.video import Video
from app.schemas.artist import ArtistDetailRead, ArtistRead, ArtistUpdate
from app.schemas.video import VideoRead
from app.services.runtime_settings import (
    get_effective_media_path,
    get_effective_transcoding_enabled,
)

router = APIRouter(prefix="/artists", tags=["artists"])


def _to_media_url(abs_path: str | None, media_root: str, cache_bust: bool = False) -> str | None:
    if not abs_path:
        return None
    try:
        rel = Path(abs_path).resolve(strict=False).relative_to(
            Path(media_root).resolve(strict=False)
        )
    except ValueError:
        return None

    url = f"/media/{rel.as_posix()}"
    if cache_bust:
        try:
            mtime = int(os.path.getmtime(abs_path))
            url += f"?v={mtime}"
        except OSError:
            pass
    return url


def _hls_playlist_url(video_id: uuid.UUID, media_root: str) -> str | None:
    playlist = Path(media_root) / settings.HLS_DIR / str(video_id) / "index.m3u8"
    if not playlist.exists():
        return None
    return f"/media/{settings.HLS_DIR}/{video_id}/index.m3u8"


def _video_to_read(
    video: Video,
    artist_name: str,
    media_root: str,
    transcoding_enabled: bool,
) -> VideoRead:
    video_url = _to_media_url(video.file_path, media_root)
    hls_url = _hls_playlist_url(video.id, media_root) if transcoding_enabled else None
    return VideoRead(
        id=video.id,
        title=video.title,
        artist_id=video.artist_id,
        artist_name=artist_name,
        album=video.album,
        duration=video.duration,
        thumbnail_url=_to_media_url(video.thumbnail_path, media_root),
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
    search: str | None = Query(None),
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
    return [
        ArtistRead(
            id=artist.id,
            name=artist.name,
            bio=artist.bio,
            image_url=_to_media_url(artist.image_path, media_root, cache_bust=True),
            video_count=count,
            created_at=artist.created_at,
        )
        for artist, count in rows
    ]


@router.get("/{artist_id}", response_model=ArtistDetailRead)
async def get_artist(artist_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Artist)
        .where(Artist.id == artist_id, Artist.deleted_at.is_(None))
        .options(selectinload(Artist.videos))
    )
    artist = result.scalar_one_or_none()
    if not artist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artist not found")

    media_root = await get_effective_media_path(db)
    transcoding_enabled = await get_effective_transcoding_enabled(db)
    active_videos = [v for v in artist.videos if v.deleted_at is None]
    return ArtistDetailRead(
        id=artist.id,
        name=artist.name,
        bio=artist.bio,
        image_url=_to_media_url(artist.image_path, media_root, cache_bust=True),
        video_count=len(active_videos),
        created_at=artist.created_at,
        videos=[_video_to_read(v, artist.name, media_root, transcoding_enabled) for v in active_videos],
    )


@router.patch("/{artist_id}", response_model=ArtistRead)
async def update_artist(
    artist_id: uuid.UUID,
    body: ArtistUpdate,
    _admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Artist).where(Artist.id == artist_id, Artist.deleted_at.is_(None)))
    artist = result.scalar_one_or_none()
    if not artist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artist not found")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(artist, field, value)

    await db.commit()
    await db.refresh(artist)

    count_result = await db.execute(
        select(func.count(Video.id)).where(Video.artist_id == artist.id, Video.deleted_at.is_(None))
    )
    video_count = count_result.scalar() or 0
    media_root = await get_effective_media_path(db)

    return ArtistRead(
        id=artist.id,
        name=artist.name,
        bio=artist.bio,
        image_url=_to_media_url(artist.image_path, media_root, cache_bust=True),
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
    _admin: User = Depends(get_current_admin),
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
    ext = os.path.splitext(file.filename or "img.jpg")[1] or ".jpg"
    safe_name = artist.name.replace("/", "_").replace(" ", "_")
    image_dir = os.path.join(media_root, ".artist-images")
    os.makedirs(image_dir, exist_ok=True)
    image_path = os.path.join(image_dir, f"{safe_name}{ext}")

    content = await file.read()
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
        bio=artist.bio,
        image_url=_to_media_url(artist.image_path, media_root, cache_bust=True),
        video_count=video_count,
        created_at=artist.created_at,
    )
