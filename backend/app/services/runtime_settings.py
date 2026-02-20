from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.system import Setting

SETTING_MEDIA_PATH = "media_path"
SETTING_TRANSCODING_ENABLED = "transcoding_enabled"


def _to_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


async def get_setting_value(
    db: AsyncSession,
    key: str,
    default: str | None = None,
) -> str | None:
    result = await db.execute(select(Setting).where(Setting.key == key))
    setting = result.scalar_one_or_none()
    if setting is None:
        return default
    return setting.value


async def set_setting_value(db: AsyncSession, key: str, value: str | None) -> Setting:
    result = await db.execute(select(Setting).where(Setting.key == key))
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = value
    else:
        setting = Setting(key=key, value=value)
        db.add(setting)
    await db.commit()
    await db.refresh(setting)
    return setting


async def get_effective_media_path(db: AsyncSession) -> str:
    return (
        await get_setting_value(db, SETTING_MEDIA_PATH, settings.MEDIA_PATH)
        or settings.MEDIA_PATH
    )


async def get_effective_transcoding_enabled(db: AsyncSession) -> bool:
    value = await get_setting_value(db, SETTING_TRANSCODING_ENABLED, "false")
    return _to_bool(value, default=False)


def get_setting_value_sync(
    session: Session,
    key: str,
    default: str | None = None,
) -> str | None:
    setting = session.execute(select(Setting).where(Setting.key == key)).scalar_one_or_none()
    if setting is None:
        return default
    return setting.value


def get_effective_media_path_sync(session: Session) -> str:
    return get_setting_value_sync(session, SETTING_MEDIA_PATH, settings.MEDIA_PATH) or settings.MEDIA_PATH


def get_effective_transcoding_enabled_sync(session: Session) -> bool:
    value = get_setting_value_sync(session, SETTING_TRANSCODING_ENABLED, "false")
    return _to_bool(value, default=False)
