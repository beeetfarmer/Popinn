import uuid
from datetime import datetime

from pydantic import BaseModel, computed_field


class VideoRead(BaseModel):
    id: uuid.UUID
    title: str
    artist_id: uuid.UUID
    artist_name: str = ""
    album: str | None = None
    duration: int | None = None
    thumbnail_url: str | None = None
    video_url: str | None = None
    playback_url: str | None = None
    year: int | None = None
    genre: str | None = None
    file_size: int | None = None
    added_at: datetime | None = None

    @computed_field
    @property
    def duration_display(self) -> str:
        if self.duration is None:
            return "0:00"
        m, s = divmod(self.duration, 60)
        return f"{m}:{s:02d}"

    model_config = {"from_attributes": True}


class VideoUpdate(BaseModel):
    title: str | None = None
    album: str | None = None
    year: int | None = None
    genre: str | None = None


class VideoBulkDelete(BaseModel):
    video_ids: list[uuid.UUID]


class VideoPlayCreate(BaseModel):
    watched_seconds: float
    video_duration_seconds: int | None = None


class VideoPlayRead(BaseModel):
    id: uuid.UUID
    watched_seconds: int
    video_duration_seconds: int | None = None
    counted_play: bool
    played_at: datetime

    model_config = {"from_attributes": True}


class VideoPlayStats(BaseModel):
    play_count: int
    total_watched_seconds: int
    history: list[VideoPlayRead]
