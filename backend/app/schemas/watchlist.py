import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.video import VideoRead


class WatchlistCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    model_config = ConfigDict(extra="forbid")


class WatchlistRead(BaseModel):
    id: uuid.UUID
    name: str
    item_count: int = 0
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class WatchlistDetailRead(WatchlistRead):
    videos: list[VideoRead] = []


class WatchlistUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    model_config = ConfigDict(extra="forbid")


class WatchlistItemAdd(BaseModel):
    video_id: uuid.UUID
    model_config = ConfigDict(extra="forbid")
