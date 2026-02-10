from datetime import datetime

from pydantic import BaseModel


class SettingRead(BaseModel):
    key: str
    value: str | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class SettingUpdate(BaseModel):
    value: str | None = None
