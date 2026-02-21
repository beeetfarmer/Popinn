from pathlib import Path

from pydantic_settings import BaseSettings

ROOT_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    PROJECT_NAME: str = "Popinn"
    API_V1_PREFIX: str = "/api/v1"

    DATABASE_URL: str = "postgresql+asyncpg://popinn:popinn@db:5432/popinn"
    SECRET_KEY: str = "change-me-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 1 day
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    ALLOWED_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"
    ACCESS_COOKIE_NAME: str = "popinn_access_token"
    REFRESH_COOKIE_NAME: str = "popinn_refresh_token"
    CSRF_COOKIE_NAME: str = "popinn_csrf_token"
    COOKIE_SECURE: bool = False
    COOKIE_DOMAIN: str | None = None
    COOKIE_SAMESITE: str = "lax"
    RATE_LIMIT_DEFAULT: str = "120/minute"
    RATE_LIMIT_AUTH: str = "10/minute"
    RATE_LIMIT_SCAN: str = "5/minute"
    BACKGROUND_WORKERS: int = 2
    VIEW_THRESHOLD_RATIO: float = 0.2

    MEDIA_PATH: str = "/media"
    LASTFM_API_KEY: str = ""
    SPOTIFY_CLIENT_ID: str = ""
    SPOTIFY_CLIENT_SECRET: str = ""
    THUMBNAIL_DIR: str = ".thumbnails"
    HLS_DIR: str = ".hls"

    model_config = {
        "env_file": str(ROOT_ENV_FILE),
        "case_sensitive": True,
        "extra": "ignore",
    }

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]


settings = Settings()
