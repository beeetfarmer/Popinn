import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_admin
from app.core.config import settings
from app.core.database import get_db
from app.models.artist import Artist
from app.models.user import User
from app.models.video import Video
from app.schemas.video import VideoRead, VideoUpdate

router = APIRouter(prefix="/videos", tags=["videos"])

SORTABLE_COLUMNS = {
    "added_at": Video.added_at,
    "title": Video.title,
    "year": Video.year,
    "album": Video.album,
}


def _to_media_url(abs_path: str | None) -> str | None:
    if not abs_path:
        return None
    media = settings.MEDIA_PATH.rstrip("/")
    if abs_path.startswith(media):
        return "/media" + abs_path[len(media):]
    return None


def _video_to_read(video: Video, artist_name: str = "") -> VideoRead:
    return VideoRead(
        id=video.id,
        title=video.title,
        artist_id=video.artist_id,
        artist_name=artist_name,
        album=video.album,
        duration=video.duration,
        thumbnail_url=_to_media_url(video.thumbnail_path),
        video_url=_to_media_url(video.file_path),
        year=video.year,
        genre=video.genre,
        file_size=video.file_size,
        added_at=video.added_at,
    )


@router.get("/", response_model=list[VideoRead])
async def list_videos(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    search: str | None = Query(None),
    artist_id: uuid.UUID | None = Query(None),
    sort_by: str = Query("added_at"),
    sort_order: str = Query("desc"),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(Video)
        .where(Video.deleted_at.is_(None))
        .options(selectinload(Video.artist))
    )

    if search:
        query = query.where(Video.title.ilike(f"%{search}%"))
    if artist_id:
        query = query.where(Video.artist_id == artist_id)

    sort_col = SORTABLE_COLUMNS.get(sort_by, Video.added_at)
    if sort_order == "asc":
        query = query.order_by(sort_col.asc())
    else:
        query = query.order_by(sort_col.desc())

    query = query.offset(skip).limit(limit)

    result = await db.execute(query)
    videos = result.scalars().all()
    return [_video_to_read(v, v.artist.name if v.artist else "") for v in videos]


@router.get("/{video_id}", response_model=VideoRead)
async def get_video(video_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Video)
        .where(Video.id == video_id, Video.deleted_at.is_(None))
        .options(selectinload(Video.artist))
    )
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found")
    return _video_to_read(video, video.artist.name if video.artist else "")


@router.patch("/{video_id}", response_model=VideoRead)
async def update_video(
    video_id: uuid.UUID,
    body: VideoUpdate,
    _admin: User = Depends(get_current_admin),
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
    return _video_to_read(video, video.artist.name if video.artist else "")


@router.delete("/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_video(
    video_id: uuid.UUID,
    _admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Video).where(Video.id == video_id, Video.deleted_at.is_(None))
    )
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found")

    video.deleted_at = datetime.now(timezone.utc)
    await db.commit()
