import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.video import VideoRead


class ArtistRead(BaseModel):
    id: uuid.UUID
    name: str
    lastfm_artist_name: str | None = None
    wikipedia_url: str | None = None
    spotify_artist_id: str | None = None
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
    # Why the list is empty when the cause is upstream, e.g. Last.fm refusing the key.
    notice: str | None = None


class LastfmArtistSearchItem(BaseModel):
    name: str
    image_url: str | None = None
    url: str | None = None


class LastfmArtistApplyRequest(BaseModel):
    """Which Last.fm artist to pull metadata from.

    Either a name picked from search results, or a pasted artist URL. The URL
    form exists because search cannot always disambiguate similarly named
    artists, and the page you actually want is the one you are looking at.
    """

    lastfm_artist_name: str | None = None
    lastfm_url: str | None = None
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _require_one(self) -> "LastfmArtistApplyRequest":
        if not (self.lastfm_artist_name or "").strip() and not (self.lastfm_url or "").strip():
            raise ValueError("Provide either lastfm_artist_name or lastfm_url")
        return self


class WikipediaArticleSearchItem(BaseModel):
    title: str
    description: str | None = None
    thumbnail_url: str | None = None
    url: str


class WikipediaArticleApplyRequest(BaseModel):
    """A Wikipedia article URL, from a search result or pasted by the admin."""

    wikipedia_url: str = Field(min_length=1, max_length=500)
    model_config = ConfigDict(extra="forbid")


class SpotifyArtistSearchItem(BaseModel):
    id: str
    name: str
    image_url: str | None = None
    followers: int | None = None
    genres: list[str] = []
    url: str | None = None


class SpotifyArtistApplyRequest(BaseModel):
    """A Spotify artist link, URI or ID; empty or null clears the pin."""

    spotify_artist: str | None = Field(None, max_length=200)
    model_config = ConfigDict(extra="forbid")
