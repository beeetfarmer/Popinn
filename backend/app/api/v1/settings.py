from fastapi import APIRouter, Depends, HTTPException, status
import os
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_admin
from app.core.database import get_db
from app.models.system import Setting
from app.models.user import User
from app.schemas.settings import (
    RuntimeSettingsRead,
    RuntimeSettingsUpdate,
    SettingRead,
    SettingUpdate,
    ThumbnailRegenerateResponse,
)
from app.services.background_jobs import submit_job
from app.services.runtime_settings import (
    SETTING_MEDIA_PATH,
    SETTING_TRANSCODING_ENABLED,
    get_effective_media_path,
    get_effective_transcoding_enabled,
    set_setting_value,
)
from app.tasks.media import regenerate_all_thumbnails

router = APIRouter(prefix="/settings", tags=["settings"])


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
    return RuntimeSettingsRead(
        media_path=await get_effective_media_path(db),
        transcoding_enabled=await get_effective_transcoding_enabled(db),
    )


@router.put("/runtime", response_model=RuntimeSettingsRead)
async def update_runtime_settings(
    body: RuntimeSettingsUpdate,
    _admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    if not os.path.isdir(body.media_path):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Media path does not exist or is not a directory",
        )

    await set_setting_value(db, SETTING_MEDIA_PATH, body.media_path)
    await set_setting_value(
        db,
        SETTING_TRANSCODING_ENABLED,
        "true" if body.transcoding_enabled else "false",
    )

    return RuntimeSettingsRead(
        media_path=body.media_path,
        transcoding_enabled=body.transcoding_enabled,
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
