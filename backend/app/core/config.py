from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    PROJECT_NAME: str = "Popinn"
    API_V1_PREFIX: str = "/api/v1"

    DATABASE_URL: str = "postgresql+asyncpg://popinn:popinn@db:5432/popinn"
    REDIS_URL: str = "redis://redis:6379/0"

    SECRET_KEY: str = "change-me-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 1 day
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    MEDIA_PATH: str = "/media"
    LASTFM_API_KEY: str = ""
    THUMBNAIL_DIR: str = ".thumbnails"

    model_config = {"env_file": ".env", "case_sensitive": True}


settings = Settings()
