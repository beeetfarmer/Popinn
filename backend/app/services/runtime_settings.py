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
SETTING_VIDEO_INFINITE_SCROLL = "video_infinite_scroll"
SETTING_LIBRARY_SCAN_INTERVAL_MINUTES = "library_scan_interval_minutes"
SETTING_METADATA_PROVIDER = "metadata_provider"
SETTING_ARTIST_BIO_SOURCES = "artist_bio_sources"
SETTING_ARTIST_IMAGE_SOURCES = "artist_image_sources"

# Artist bio/image sources, as comma-separated lists in priority order. A source
# left out of the list is disabled. Spotify images are only displayed, never
# stored, so they are resolved per request (see artists API).
ARTIST_BIO_SOURCES = ("wikipedia", "lastfm")
ARTIST_IMAGE_SOURCES = ("spotify", "deezer", "wikipedia", "lastfm")
DEFAULT_ARTIST_BIO_SOURCES = "wikipedia,lastfm"
DEFAULT_ARTIST_IMAGE_SOURCES = "deezer,wikipedia,lastfm"

METADATA_PROVIDERS = ("spotify", "musicbrainz")


def spotify_configured() -> bool:
    return bool(settings.SPOTIFY_CLIENT_ID.strip() and settings.SPOTIFY_CLIENT_SECRET.strip())


def _to_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def parse_source_order(value: str | None, allowed: tuple[str, ...], default: str) -> list[str]:
    raw = default if value is None else value
    order: list[str] = []
    for item in raw.split(","):
        item = item.strip().lower()
        if item in allowed and item not in order:
            order.append(item)
    return order


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


async def get_effective_video_infinite_scroll(db: AsyncSession) -> bool:
    """Whether video lists scroll continuously instead of using page controls."""
    value = await get_setting_value(db, SETTING_VIDEO_INFINITE_SCROLL, "false")
    return _to_bool(value, default=False)


async def get_effective_library_scan_interval_minutes(db: AsyncSession) -> int:
    """Minutes between automatic library scans; 0 (or negative) disables it."""
    default = max(0, settings.LIBRARY_SCAN_INTERVAL_MINUTES)
    value = await get_setting_value(db, SETTING_LIBRARY_SCAN_INTERVAL_MINUTES, str(default))
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return default


async def get_effective_metadata_provider(db: AsyncSession) -> str:
    """Which service backs metadata search. Defaults to Spotify when its
    credentials are configured, otherwise MusicBrainz (which needs no account)."""
    default = "spotify" if spotify_configured() else "musicbrainz"
    value = await get_setting_value(db, SETTING_METADATA_PROVIDER, default)
    return value if value in METADATA_PROVIDERS else default


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


async def get_effective_artist_bio_sources(db: AsyncSession) -> list[str]:
    value = await get_setting_value(db, SETTING_ARTIST_BIO_SOURCES)
    return parse_source_order(value, ARTIST_BIO_SOURCES, DEFAULT_ARTIST_BIO_SOURCES)


async def get_effective_artist_image_sources(db: AsyncSession) -> list[str]:
    value = await get_setting_value(db, SETTING_ARTIST_IMAGE_SOURCES)
    return parse_source_order(value, ARTIST_IMAGE_SOURCES, DEFAULT_ARTIST_IMAGE_SOURCES)


def get_effective_artist_bio_sources_sync(session: Session) -> list[str]:
    value = get_setting_value_sync(session, SETTING_ARTIST_BIO_SOURCES)
    return parse_source_order(value, ARTIST_BIO_SOURCES, DEFAULT_ARTIST_BIO_SOURCES)


def get_effective_artist_image_sources_sync(session: Session) -> list[str]:
    value = get_setting_value_sync(session, SETTING_ARTIST_IMAGE_SOURCES)
    return parse_source_order(value, ARTIST_IMAGE_SOURCES, DEFAULT_ARTIST_IMAGE_SOURCES)
