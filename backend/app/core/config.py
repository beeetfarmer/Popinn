from pathlib import Path

from pydantic_settings import BaseSettings

ROOT_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    PROJECT_NAME: str = "Popinn"
    API_V1_PREFIX: str = "/api/v1"

    DATABASE_URL: str = "postgresql+asyncpg://popinn:popinn@db:5432/popinn"
    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 1 day
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    ALLOW_PUBLIC_REGISTRATION: bool = False
    ALLOW_RUNTIME_PATH_CHANGES: bool = False
    ALLOWED_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"
    ALLOWED_HOSTS: str = "localhost,127.0.0.1,backend,web"
    ACCESS_COOKIE_NAME: str = "popinn_access_token"
    REFRESH_COOKIE_NAME: str = "popinn_refresh_token"
    CSRF_COOKIE_NAME: str = "popinn_csrf_token"
    COOKIE_SECURE: bool = True
    COOKIE_DOMAIN: str | None = None
    COOKIE_SAMESITE: str = "lax"
    STREAM_TOKENIZATION_ENABLED: bool = False
    STREAM_TOKEN_REQUIRED: bool = False
    STREAM_TOKEN_TTL_SECONDS: int = 21600
    RATE_LIMIT_DEFAULT: str = "120/minute"
    RATE_LIMIT_AUTH: str = "10/minute"
    RATE_LIMIT_SCAN: str = "5/minute"
    RATE_LIMIT_SPOTIFY_SEARCH: str = "45/minute"
    RATE_LIMIT_LASTFM_SEARCH: str = "45/minute"
    RATE_LIMIT_ARTIST_METADATA_REFRESH: str = "20/minute"
    RATE_LIMIT_PLAY_EVENT: str = "240/minute"
    RATE_LIMIT_SETTINGS_IMPORT: str = "6/minute"
    SPOTIFY_API_RATE_LIMIT: str = "10/second"
    LASTFM_API_RATE_LIMIT: str = "5/second"
    EXTERNAL_API_MAX_RETRIES: int = 2
    EXTERNAL_API_RETRY_BACKOFF_SECONDS: float = 0.5
    BACKGROUND_WORKERS: int = 2
    LIBRARY_SCAN_INTERVAL_MINUTES: int = 0  # 0 disables the automatic periodic scan
    VIEW_THRESHOLD_RATIO: float = 0.2
    MAX_IMAGE_UPLOAD_BYTES: int = 5 * 1024 * 1024
    MAX_SETTINGS_IMPORT_BYTES: int = 10 * 1024 * 1024
    MAX_SUBTITLE_FILE_BYTES: int = 2 * 1024 * 1024

    MEDIA_PATH: str = "/media"
    APP_DATA_PATH: str = "./app-data"
    APP_DATA_PUBLIC_SUBDIRS: str = ".thumbnails,.previews,.hls,.artist-images,.user-images"
    LASTFM_API_KEY: str = ""
    LASTFM_CACHE_TTL_HOURS: int = 168
    SPOTIFY_CLIENT_ID: str = ""
    SPOTIFY_CLIENT_SECRET: str = ""
    THUMBNAIL_DIR: str = ".thumbnails"
    PREVIEW_DIR: str = ".previews"
    HLS_DIR: str = ".hls"

    model_config = {
        "env_file": str(ROOT_ENV_FILE),
        "case_sensitive": True,
        "extra": "ignore",
    }

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]

    @property
    def allowed_hosts(self) -> list[str]:
        hosts = [host.strip() for host in self.ALLOWED_HOSTS.split(",") if host.strip()]
        return hosts or ["localhost", "127.0.0.1"]

    @property
    def app_data_public_subdirs(self) -> set[str]:
        return {
            segment.strip()
            for segment in self.APP_DATA_PUBLIC_SUBDIRS.split(",")
            if segment.strip()
        }


settings = Settings()
