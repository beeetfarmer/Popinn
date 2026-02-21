from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.system import Setting

SETTING_MEDIA_PATH = "media_path"
SETTING_APP_DATA_PATH = "app_data_path"
SETTING_TRANSCODING_ENABLED = "transcoding_enabled"
SETTING_VIEW_THRESHOLD_RATIO = "view_threshold_ratio"
SETTING_LASTFM_OVERRIDE_LOCAL_ARTIST_IMAGES = "lastfm_override_local_artist_images"


def _to_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _to_ratio(
    value: str | None,
    default: float,
) -> float:
    if value is None:
        return default
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(1.0, parsed))


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


async def get_effective_app_data_path(db: AsyncSession) -> str:
    return (
        await get_setting_value(db, SETTING_APP_DATA_PATH, settings.APP_DATA_PATH)
        or settings.APP_DATA_PATH
    )


async def get_effective_transcoding_enabled(db: AsyncSession) -> bool:
    value = await get_setting_value(db, SETTING_TRANSCODING_ENABLED, "false")
    return _to_bool(value, default=False)


async def get_effective_view_threshold_ratio(db: AsyncSession) -> float:
    default = max(0.0, min(1.0, settings.VIEW_THRESHOLD_RATIO))
    value = await get_setting_value(db, SETTING_VIEW_THRESHOLD_RATIO, str(default))
    return _to_ratio(value, default=default)


async def get_effective_lastfm_override_local_artist_images(db: AsyncSession) -> bool:
    value = await get_setting_value(
        db,
        SETTING_LASTFM_OVERRIDE_LOCAL_ARTIST_IMAGES,
        "true",
    )
    return _to_bool(value, default=True)


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


def get_effective_app_data_path_sync(session: Session) -> str:
    return (
        get_setting_value_sync(session, SETTING_APP_DATA_PATH, settings.APP_DATA_PATH)
        or settings.APP_DATA_PATH
    )


def get_effective_transcoding_enabled_sync(session: Session) -> bool:
    value = get_setting_value_sync(session, SETTING_TRANSCODING_ENABLED, "false")
    return _to_bool(value, default=False)


def get_effective_view_threshold_ratio_sync(session: Session) -> float:
    default = max(0.0, min(1.0, settings.VIEW_THRESHOLD_RATIO))
    value = get_setting_value_sync(session, SETTING_VIEW_THRESHOLD_RATIO, str(default))
    return _to_ratio(value, default=default)


def get_effective_lastfm_override_local_artist_images_sync(session: Session) -> bool:
    value = get_setting_value_sync(
        session,
        SETTING_LASTFM_OVERRIDE_LOCAL_ARTIST_IMAGES,
        "true",
    )
    return _to_bool(value, default=True)
