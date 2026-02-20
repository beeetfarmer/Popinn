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
    transcoding_enabled: bool


class RuntimeSettingsUpdate(BaseModel):
    media_path: str = Field(min_length=1)
    transcoding_enabled: bool


class ThumbnailRegenerateResponse(BaseModel):
    message: str
    task_id: str
