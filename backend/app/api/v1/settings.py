from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_admin
from app.core.database import get_db
from app.models.system import Setting
from app.models.user import User
from app.schemas.settings import SettingRead, SettingUpdate

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/", response_model=list[SettingRead])
async def list_settings(
    _admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Setting).order_by(Setting.key))
    settings = result.scalars().all()
    return [
        SettingRead(key=s.key, value=s.value, updated_at=s.updated_at)
        for s in settings
    ]


@router.put("/{key}", response_model=SettingRead)
async def upsert_setting(
    key: str,
    body: SettingUpdate,
    _admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Setting).where(Setting.key == key))
    setting = result.scalar_one_or_none()

    if setting:
        setting.value = body.value
    else:
        setting = Setting(key=key, value=body.value)
        db.add(setting)

    await db.commit()
    await db.refresh(setting)
    return SettingRead(key=setting.key, value=setting.value, updated_at=setting.updated_at)
