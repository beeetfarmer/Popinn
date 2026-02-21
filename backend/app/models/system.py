import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ScanStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class ScanJob(Base):
    __tablename__ = "scan_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    status: Mapped[ScanStatus] = mapped_column(
        default=ScanStatus.pending, server_default=ScanStatus.pending.value
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    files_found: Mapped[int | None] = mapped_column(Integer)
    files_added: Mapped[int | None] = mapped_column(Integer)
    folders_total: Mapped[int | None] = mapped_column(Integer)
    folders_processed: Mapped[int | None] = mapped_column(Integer)
    current_folder: Mapped[str | None] = mapped_column(String(500))
    errors: Mapped[str | None] = mapped_column(Text)


class Setting(Base):
    __tablename__ = "settings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    key: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    value: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
