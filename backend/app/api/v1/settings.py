from datetime import datetime, timezone
import json
from fastapi import APIRouter, Depends, File, UploadFile, HTTPException, status
import os
from sqlalchemy import and_, case, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_admin, get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.uploads import read_upload_limited
from app.models.playback import VideoPlay
from app.models.system import Setting
from app.models.user import User
from app.models.video import Video
from app.schemas.settings import (
    BrowsingSettingsRead,
    PlaybackExportItem,
    RuntimeSettingsRead,
    RuntimeSettingsUpdate,
    ViewThresholdRead,
    SettingExportItem,
    SettingRead,
    SettingsExportPayload,
    SettingsImportResponse,
    SettingUpdate,
    ThumbnailRegenerateResponse,
)
from app.services.background_jobs import submit_job
from app.services.playback import is_counted_view
from app.services.runtime_settings import (
    SETTING_APP_DATA_PATH,
    SETTING_LASTFM_OVERRIDE_LOCAL_ARTIST_IMAGES,
    SETTING_MEDIA_PATH,
    SETTING_TRANSCODING_ENABLED,
    SETTING_VIDEO_INFINITE_SCROLL,
    SETTING_VIEW_THRESHOLD_RATIO,
    get_effective_app_data_path,
    get_effective_lastfm_override_local_artist_images,
    get_effective_media_path,
    get_effective_transcoding_enabled,
    get_effective_video_infinite_scroll,
    get_effective_view_threshold_ratio,
    set_setting_value,
)
from app.tasks.media import regenerate_all_thumbnails

router = APIRouter(prefix="/settings", tags=["settings"])
EXPORTABLE_SETTING_KEYS = {
    SETTING_MEDIA_PATH,
    SETTING_APP_DATA_PATH,
    SETTING_TRANSCODING_ENABLED,
    SETTING_VIEW_THRESHOLD_RATIO,
    SETTING_LASTFM_OVERRIDE_LOCAL_ARTIST_IMAGES,
    SETTING_VIDEO_INFINITE_SCROLL,
}


@router.get("/", response_model=list[SettingRead])
async def list_settings(
    _admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Setting).order_by(Setting.key))
    app_settings = result.scalars().all()
    return [
        SettingRead(key=s.key, value=s.value, updated_at=s.updated_at)
        for s in app_settings
    ]


@router.put("/kv/{key}", response_model=SettingRead)
async def upsert_setting(
    key: str,
    body: SettingUpdate,
    _admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    setting = await set_setting_value(db, key, body.value)
    return SettingRead(key=setting.key, value=setting.value, updated_at=setting.updated_at)


@router.get("/runtime", response_model=RuntimeSettingsRead)
async def get_runtime_settings(
    _admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    threshold_ratio = await get_effective_view_threshold_ratio(db)
    return RuntimeSettingsRead(
        media_path=await get_effective_media_path(db),
        app_data_path=await get_effective_app_data_path(db),
        transcoding_enabled=await get_effective_transcoding_enabled(db),
        view_threshold_percent=max(1, min(100, int(round(threshold_ratio * 100)))),
        lastfm_override_local_artist_images=await get_effective_lastfm_override_local_artist_images(db),
        video_infinite_scroll=await get_effective_video_infinite_scroll(db),
    )


@router.put("/runtime", response_model=RuntimeSettingsRead)
async def update_runtime_settings(
    body: RuntimeSettingsUpdate,
    _admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    current_media_path = await get_effective_media_path(db)
    current_app_data_path = await get_effective_app_data_path(db)
    paths_changed = (
        body.media_path != current_media_path
        or body.app_data_path != current_app_data_path
    )

    if not settings.ALLOW_RUNTIME_PATH_CHANGES:
        if paths_changed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Runtime media/app-data path changes are disabled on this server",
            )

    if paths_changed and (
        not os.path.isabs(body.media_path) or not os.path.isabs(body.app_data_path)
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Runtime paths must be absolute paths",
        )

    if not os.path.isdir(body.media_path):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Media path does not exist or is not a directory",
        )
    try:
        os.makedirs(body.app_data_path, exist_ok=True)
    except OSError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="App data path could not be created",
        )
    if not os.path.isdir(body.app_data_path):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="App data path does not exist or is not a directory",
        )

    existing_threshold_ratio = await get_effective_view_threshold_ratio(db)

    await set_setting_value(db, SETTING_MEDIA_PATH, body.media_path)
    await set_setting_value(db, SETTING_APP_DATA_PATH, body.app_data_path)
    await set_setting_value(
        db,
        SETTING_TRANSCODING_ENABLED,
        "true" if body.transcoding_enabled else "false",
    )
    threshold_ratio = max(0.01, min(1.0, body.view_threshold_percent / 100))
    await set_setting_value(
        db,
        SETTING_VIEW_THRESHOLD_RATIO,
        str(threshold_ratio),
    )
    await set_setting_value(
        db,
        SETTING_LASTFM_OVERRIDE_LOCAL_ARTIST_IMAGES,
        "true" if body.lastfm_override_local_artist_images else "false",
    )
    await set_setting_value(
        db,
        SETTING_VIDEO_INFINITE_SCROLL,
        "true" if body.video_infinite_scroll else "false",
    )
    if abs(existing_threshold_ratio - threshold_ratio) > 1e-9:
        await db.execute(
            update(VideoPlay).values(
                counted_play=case(
                    (
                        and_(
                            VideoPlay.video_duration_seconds.is_not(None),
                            VideoPlay.video_duration_seconds > 0,
                            VideoPlay.watched_seconds
                            >= (VideoPlay.video_duration_seconds * threshold_ratio),
                        ),
                        True,
                    ),
                    else_=False,
                )
            )
        )
        await db.commit()

    return RuntimeSettingsRead(
        media_path=body.media_path,
        app_data_path=body.app_data_path,
        transcoding_enabled=body.transcoding_enabled,
        view_threshold_percent=max(1, min(100, int(round(threshold_ratio * 100)))),
        lastfm_override_local_artist_images=body.lastfm_override_local_artist_images,
        video_infinite_scroll=body.video_infinite_scroll,
    )


@router.get("/view-threshold", response_model=ViewThresholdRead)
async def get_view_threshold(
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    threshold_ratio = await get_effective_view_threshold_ratio(db)
    return ViewThresholdRead(
        view_threshold_percent=max(1, min(100, int(round(threshold_ratio * 100)))),
    )


@router.get("/browsing", response_model=BrowsingSettingsRead)
async def get_browsing_settings(
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List behaviour every signed-in user needs, not just admins."""
    return BrowsingSettingsRead(
        video_infinite_scroll=await get_effective_video_infinite_scroll(db),
    )


@router.post("/thumbnail-regenerate", response_model=ThumbnailRegenerateResponse)
async def trigger_thumbnail_regeneration(
    _admin: User = Depends(get_current_admin),
):
    task_id = submit_job("thumbnail_regen", regenerate_all_thumbnails)
    return ThumbnailRegenerateResponse(
        message="Thumbnail regeneration started",
        task_id=task_id,
    )


@router.get("/export", response_model=SettingsExportPayload)
async def export_settings_and_history(
    _admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    settings_rows = (
        await db.execute(
            select(Setting)
            .where(Setting.key.in_(EXPORTABLE_SETTING_KEYS))
            .order_by(Setting.key)
        )
    ).scalars().all()

    play_rows = (
        await db.execute(
            select(VideoPlay, User, Video)
            .join(User, VideoPlay.user_id == User.id)
            .join(Video, VideoPlay.video_id == Video.id)
            .order_by(VideoPlay.played_at)
        )
    ).all()

    return SettingsExportPayload(
        exported_at=datetime.now(timezone.utc),
        settings=[SettingExportItem(key=s.key, value=s.value) for s in settings_rows],
        playback_history=[
            PlaybackExportItem(
                user_email=user.email,
                user_username=user.username,
                video_file_path=video.file_path,
                watched_seconds=play.watched_seconds,
                video_duration_seconds=play.video_duration_seconds,
                counted_play=play.counted_play,
                played_at=play.played_at,
            )
            for play, user, video in play_rows
        ],
    )


def _parse_played_at(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        if value.endswith("Z"):
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        return datetime.fromisoformat(value)
    except ValueError:
        return datetime.now(timezone.utc)


@router.post("/import", response_model=SettingsImportResponse)
async def import_settings_and_history(
    file: UploadFile = File(...),
    _admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    allowed_content_types = {"application/json", "text/json", "application/octet-stream"}
    content_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    if content_type and content_type not in allowed_content_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Import file must be JSON",
        )

    try:
        raw = await read_upload_limited(
            file,
            settings.MAX_SETTINGS_IMPORT_BYTES,
            "Import file is too large",
        )
        if not raw:
            raise ValueError("empty import")
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("invalid import root")
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON file",
        )

    imported_settings = 0
    imported_playback = 0
    skipped_playback = 0
    warnings: list[str] = []

    for setting_item in payload.get("settings", []):
        if not isinstance(setting_item, dict):
            continue
        key = setting_item.get("key")
        if not key or not isinstance(key, str):
            continue
        if key not in EXPORTABLE_SETTING_KEYS:
            continue
        if (
            key in {SETTING_MEDIA_PATH, SETTING_APP_DATA_PATH}
            and not settings.ALLOW_RUNTIME_PATH_CHANGES
        ):
            if len(warnings) < 25:
                warnings.append(f"Skipped restricted setting key: {key}")
            continue
        value = setting_item.get("value")
        await set_setting_value(db, key, value if isinstance(value, str) or value is None else str(value))
        imported_settings += 1

    user_cache: dict[str, User | None] = {}
    video_cache: dict[str, Video | None] = {}
    threshold_ratio = await get_effective_view_threshold_ratio(db)

    playback_rows = payload.get("playback_history", [])
    if not isinstance(playback_rows, list):
        playback_rows = []
    if len(playback_rows) > 100_000:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Import contains too many playback history rows",
        )

    for play_item in playback_rows:
        if not isinstance(play_item, dict):
            skipped_playback += 1
            continue
        email = str(play_item.get("user_email") or "").strip()
        username = str(play_item.get("user_username") or "").strip()
        video_file_path = str(play_item.get("video_file_path") or "").strip()
        try:
            watched_seconds = int(play_item.get("watched_seconds") or 0)
        except (TypeError, ValueError):
            skipped_playback += 1
            if len(warnings) < 25:
                warnings.append("Skipped playback row: invalid watched_seconds")
            continue
        video_duration_seconds = play_item.get("video_duration_seconds")
        played_at_raw = play_item.get("played_at")
        counted_play = play_item.get("counted_play")

        if not email and not username:
            skipped_playback += 1
            if len(warnings) < 25:
                warnings.append("Skipped playback row: missing user")
            continue
        if not video_file_path:
            skipped_playback += 1
            if len(warnings) < 25:
                warnings.append("Skipped playback row: missing video_file_path")
            continue

        user_key = email or f"username:{username}"
        user = user_cache.get(user_key)
        if user_key not in user_cache:
            user = None
            if email:
                user = await db.scalar(select(User).where(User.email == email))
            if not user and username:
                user = await db.scalar(select(User).where(User.username == username))
            user_cache[user_key] = user

        if not user:
            skipped_playback += 1
            if len(warnings) < 25:
                warnings.append(f"Skipped playback row: user not found ({email or username})")
            continue

        video = video_cache.get(video_file_path)
        if video_file_path not in video_cache:
            video = await db.scalar(select(Video).where(Video.file_path == video_file_path))
            video_cache[video_file_path] = video

        if not video:
            skipped_playback += 1
            if len(warnings) < 25:
                warnings.append(f"Skipped playback row: video not found ({video_file_path})")
            continue

        played_at = _parse_played_at(played_at_raw if isinstance(played_at_raw, str) else None)
        existing = await db.scalar(
            select(VideoPlay).where(
                VideoPlay.user_id == user.id,
                VideoPlay.video_id == video.id,
                VideoPlay.played_at == played_at,
                VideoPlay.watched_seconds == watched_seconds,
            )
        )
        if existing:
            skipped_playback += 1
            continue

        if isinstance(video_duration_seconds, int):
            duration = video_duration_seconds
        else:
            try:
                duration = int(video_duration_seconds)
            except (TypeError, ValueError):
                duration = video.duration
        if isinstance(counted_play, bool):
            is_counted_play = counted_play
        else:
            is_counted_play = is_counted_view(
                watched_seconds=watched_seconds,
                video_duration_seconds=duration,
                threshold_ratio=threshold_ratio,
            )

        db.add(
            VideoPlay(
                video_id=video.id,
                user_id=user.id,
                watched_seconds=max(0, watched_seconds),
                video_duration_seconds=duration,
                counted_play=is_counted_play,
                played_at=played_at,
            )
        )
        imported_playback += 1

    await db.commit()

    return SettingsImportResponse(
        imported_settings=imported_settings,
        imported_playback_history=imported_playback,
        skipped_playback_history=skipped_playback,
        warnings=warnings,
    )
