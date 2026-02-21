import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class VideoPlay(Base):
    __tablename__ = "video_plays"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    video_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("videos.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    watched_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    video_duration_seconds: Mapped[int | None] = mapped_column(Integer)
    counted_play: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    played_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    video: Mapped["Video"] = relationship(back_populates="plays")  # noqa: F821

    __table_args__ = (
        Index("ix_video_plays_video_id", "video_id"),
        Index("ix_video_plays_user_id", "user_id"),
        Index("ix_video_plays_counted_play", "counted_play"),
        Index("ix_video_plays_played_at", "played_at"),
    )
