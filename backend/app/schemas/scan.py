import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.system import ScanStatus


class ScanJobRead(BaseModel):
    id: uuid.UUID
    status: ScanStatus
    started_at: datetime | None = None
    completed_at: datetime | None = None
    files_found: int | None = None
    files_added: int | None = None
    errors: str | None = None

    model_config = {"from_attributes": True}


class ScanTriggerResponse(BaseModel):
    job_id: uuid.UUID
    message: str
