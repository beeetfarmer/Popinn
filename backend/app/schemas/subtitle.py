import uuid

from pydantic import BaseModel


class SubtitleRead(BaseModel):
    id: uuid.UUID
    video_id: uuid.UUID
    language: str
    format: str
    url: str

    model_config = {"from_attributes": True}
