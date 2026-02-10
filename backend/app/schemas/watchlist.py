import uuid
from datetime import datetime

from pydantic import BaseModel

from app.schemas.video import VideoRead


class WatchlistCreate(BaseModel):
    name: str


class WatchlistRead(BaseModel):
    id: uuid.UUID
    name: str
    item_count: int = 0
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class WatchlistDetailRead(WatchlistRead):
    videos: list[VideoRead] = []


class WatchlistUpdate(BaseModel):
    name: str


class WatchlistItemAdd(BaseModel):
    video_id: uuid.UUID
