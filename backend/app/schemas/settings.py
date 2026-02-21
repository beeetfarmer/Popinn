from datetime import datetime

from pydantic import BaseModel, Field


class SettingRead(BaseModel):
    key: str
    value: str | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class SettingUpdate(BaseModel):
    value: str | None = None


class RuntimeSettingsRead(BaseModel):
    media_path: str
    app_data_path: str
    transcoding_enabled: bool
    view_threshold_percent: int = Field(ge=1, le=100)
    lastfm_override_local_artist_images: bool


class RuntimeSettingsUpdate(BaseModel):
    media_path: str = Field(min_length=1)
    app_data_path: str = Field(min_length=1)
    transcoding_enabled: bool
    view_threshold_percent: int = Field(ge=1, le=100)
    lastfm_override_local_artist_images: bool = True


class ViewThresholdRead(BaseModel):
    view_threshold_percent: int = Field(ge=1, le=100)


class ThumbnailRegenerateResponse(BaseModel):
    message: str
    task_id: str


class SettingExportItem(BaseModel):
    key: str
    value: str | None = None


class PlaybackExportItem(BaseModel):
    user_email: str
    user_username: str
    video_file_path: str
    watched_seconds: int
    video_duration_seconds: int | None = None
    counted_play: bool
    played_at: datetime


class SettingsExportPayload(BaseModel):
    version: int = 1
    exported_at: datetime
    settings: list[SettingExportItem]
    playback_history: list[PlaybackExportItem]


class SettingsImportResponse(BaseModel):
    imported_settings: int
    imported_playback_history: int
    skipped_playback_history: int
    warnings: list[str] = []
