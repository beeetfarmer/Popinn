import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.video import VideoRead


class ArtistRead(BaseModel):
    id: uuid.UUID
    name: str
    lastfm_artist_name: str | None = None
    bio: str | None = None
    image_url: str | None = None
    video_count: int = 0
    play_count: int = 0
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class ArtistUpdate(BaseModel):
    name: str | None = None
    lastfm_artist_name: str | None = None
    bio: str | None = None
    image_url: str | None = None
    model_config = ConfigDict(extra="forbid")


class ArtistDetailRead(ArtistRead):
    videos: list[VideoRead] = []


class ArtistRecommendationRead(ArtistRead):
    lastfm_match: float | None = None


class ArtistRecommendationsPage(BaseModel):
    items: list[ArtistRecommendationRead]
    offset: int
    limit: int
    has_more: bool


class LastfmArtistSearchItem(BaseModel):
    name: str
    image_url: str | None = None
    url: str | None = None


class LastfmArtistApplyRequest(BaseModel):
    lastfm_artist_name: str
    model_config = ConfigDict(extra="forbid")
