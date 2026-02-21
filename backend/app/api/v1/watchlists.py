import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.user import User
from app.models.video import Video
from app.models.watchlist import Watchlist, WatchlistItem
from app.schemas.video import VideoRead
from app.schemas.watchlist import (
    WatchlistCreate,
    WatchlistDetailRead,
    WatchlistItemAdd,
    WatchlistRead,
    WatchlistUpdate,
)
from app.services.path_urls import to_public_asset_url
from app.services.runtime_settings import (
    get_effective_app_data_path,
    get_effective_media_path,
    get_effective_transcoding_enabled,
)

router = APIRouter(prefix="/watchlists", tags=["watchlists"])


def _asset_url(abs_path_or_url: str | None, media_root: str, app_data_root: str) -> str | None:
    return to_public_asset_url(
        abs_path_or_url,
        media_root=media_root,
        app_data_root=app_data_root,
    )


def _hls_playlist_url(video_id: uuid.UUID, app_data_root: str) -> str | None:
    playlist = Path(app_data_root) / settings.HLS_DIR / str(video_id) / "index.m3u8"
    if not playlist.exists():
        return None
    return f"/data/{settings.HLS_DIR}/{video_id}/index.m3u8"


def _video_to_read(
    video: Video,
    media_root: str,
    app_data_root: str,
    transcoding_enabled: bool,
) -> VideoRead:
    video_url = _asset_url(video.file_path, media_root, app_data_root)
    hls_url = _hls_playlist_url(video.id, app_data_root) if transcoding_enabled else None
    return VideoRead(
        id=video.id,
        title=video.title,
        artist_id=video.artist_id,
        artist_name=video.artist.name if video.artist else "",
        album=video.album,
        duration=video.duration,
        thumbnail_url=_asset_url(video.thumbnail_path, media_root, app_data_root),
        video_url=video_url,
        playback_url=hls_url or video_url,
        year=video.year,
        genre=video.genre,
        file_size=video.file_size,
        added_at=video.added_at,
    )


async def _get_user_watchlist(
    watchlist_id: uuid.UUID, user: User, db: AsyncSession
) -> Watchlist:
    result = await db.execute(
        select(Watchlist).where(
            Watchlist.id == watchlist_id, Watchlist.user_id == user.id
        )
    )
    watchlist = result.scalar_one_or_none()
    if not watchlist:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Watchlist not found"
        )
    return watchlist


async def _count_active_watchlist_items(
    watchlist_id: uuid.UUID,
    db: AsyncSession,
) -> int:
    count_result = await db.execute(
        select(func.count(Video.id))
        .select_from(WatchlistItem)
        .join(Video, WatchlistItem.video_id == Video.id)
        .where(
            WatchlistItem.watchlist_id == watchlist_id,
            Video.deleted_at.is_(None),
        )
    )
    return int(count_result.scalar() or 0)


@router.post("/", response_model=WatchlistRead, status_code=status.HTTP_201_CREATED)
async def create_watchlist(
    body: WatchlistCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    watchlist = Watchlist(name=body.name, user_id=user.id)
    db.add(watchlist)
    await db.commit()
    await db.refresh(watchlist)
    return WatchlistRead(
        id=watchlist.id,
        name=watchlist.name,
        item_count=0,
        created_at=watchlist.created_at,
    )


@router.get("/", response_model=list[WatchlistRead])
async def list_watchlists(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Watchlist, func.count(Video.id).label("item_count"))
        .outerjoin(WatchlistItem, WatchlistItem.watchlist_id == Watchlist.id)
        .outerjoin(
            Video,
            (Video.id == WatchlistItem.video_id) & Video.deleted_at.is_(None),
        )
        .where(Watchlist.user_id == user.id)
        .group_by(Watchlist.id)
        .order_by(Watchlist.created_at.desc())
    )
    rows = result.all()
    return [
        WatchlistRead(
            id=wl.id,
            name=wl.name,
            item_count=count,
            created_at=wl.created_at,
        )
        for wl, count in rows
    ]


@router.get("/{watchlist_id}", response_model=WatchlistDetailRead)
async def get_watchlist(
    watchlist_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Watchlist)
        .where(Watchlist.id == watchlist_id, Watchlist.user_id == user.id)
        .options(
            selectinload(Watchlist.items)
            .selectinload(WatchlistItem.video)
            .selectinload(Video.artist)
        )
    )
    watchlist = result.scalar_one_or_none()
    if not watchlist:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Watchlist not found"
        )

    media_root = await get_effective_media_path(db)
    app_data_root = await get_effective_app_data_path(db)
    transcoding_enabled = await get_effective_transcoding_enabled(db)
    videos = [
        _video_to_read(item.video, media_root, app_data_root, transcoding_enabled)
        for item in watchlist.items
        if item.video and item.video.deleted_at is None
    ]
    return WatchlistDetailRead(
        id=watchlist.id,
        name=watchlist.name,
        item_count=len(videos),
        created_at=watchlist.created_at,
        videos=videos,
    )


@router.patch("/{watchlist_id}", response_model=WatchlistRead)
async def update_watchlist(
    watchlist_id: uuid.UUID,
    body: WatchlistUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    watchlist = await _get_user_watchlist(watchlist_id, user, db)
    watchlist.name = body.name
    await db.commit()
    await db.refresh(watchlist)

    item_count = await _count_active_watchlist_items(watchlist.id, db)
    return WatchlistRead(
        id=watchlist.id,
        name=watchlist.name,
        item_count=item_count,
        created_at=watchlist.created_at,
    )


@router.delete("/{watchlist_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_watchlist(
    watchlist_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    watchlist = await _get_user_watchlist(watchlist_id, user, db)
    await db.delete(watchlist)
    await db.commit()


@router.post(
    "/{watchlist_id}/videos",
    response_model=WatchlistRead,
    status_code=status.HTTP_201_CREATED,
)
async def add_video_to_watchlist(
    watchlist_id: uuid.UUID,
    body: WatchlistItemAdd,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    watchlist = await _get_user_watchlist(watchlist_id, user, db)

    result = await db.execute(
        select(Video).where(Video.id == body.video_id, Video.deleted_at.is_(None))
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Video not found"
        )

    item = WatchlistItem(watchlist_id=watchlist.id, video_id=body.video_id)
    db.add(item)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Video already in watchlist",
        )

    item_count = await _count_active_watchlist_items(watchlist.id, db)
    return WatchlistRead(
        id=watchlist.id,
        name=watchlist.name,
        item_count=item_count,
        created_at=watchlist.created_at,
    )


@router.delete(
    "/{watchlist_id}/videos/{video_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def remove_video_from_watchlist(
    watchlist_id: uuid.UUID,
    video_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_user_watchlist(watchlist_id, user, db)

    result = await db.execute(
        select(WatchlistItem).where(
            WatchlistItem.watchlist_id == watchlist_id,
            WatchlistItem.video_id == video_id,
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Video not in watchlist",
        )
    await db.delete(item)
    await db.commit()
