import uuid
from datetime import datetime

from pydantic import BaseModel


class ArtistRead(BaseModel):
    id: uuid.UUID
    name: str
    bio: str | None = None
    image_url: str | None = None
    video_count: int = 0
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class ArtistUpdate(BaseModel):
    bio: str | None = None
    image_url: str | None = None


class ArtistDetailRead(ArtistRead):
    videos: list = []
