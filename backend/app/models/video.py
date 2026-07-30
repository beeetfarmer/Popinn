import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Video(Base):
    __tablename__ = "videos"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    artist_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("artists.id"), nullable=False
    )
    file_path: Mapped[str] = mapped_column(String(1000), unique=True, nullable=False)
    duration: Mapped[int | None] = mapped_column(Integer)
    thumbnail_path: Mapped[str | None] = mapped_column(String(1000))
    preview_path: Mapped[str | None] = mapped_column(String(1000))
    album: Mapped[str | None] = mapped_column(String(255))
    year: Mapped[int | None] = mapped_column(Integer)
    genre: Mapped[str | None] = mapped_column(String(100))
    file_size: Mapped[int | None] = mapped_column(BigInteger)
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # When the file itself was created on disk, which is what "recently added"
    # should mean. added_at is only when this row was inserted, so on a first
    # scan the whole library shares one timestamp. Nullable because it is
    # backfilled by the scanner, not by the migration.
    file_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Set alongside deleted_at when the row was hidden because its file vanished
    # rather than because a user deleted it. That distinction is what lets a
    # reappearing file be restored while a deliberate deletion stays deleted.
    # Deliberately a second column rather than a replacement for deleted_at, so
    # every existing "is this video visible" query keeps working untouched.
    missing_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    artist: Mapped["Artist"] = relationship(back_populates="videos")  # noqa: F821
    subtitles: Mapped[list["Subtitle"]] = relationship(back_populates="video")  # noqa: F821
    watchlist_items: Mapped[list["WatchlistItem"]] = relationship(  # noqa: F821
        back_populates="video"
    )
    plays: Mapped[list["VideoPlay"]] = relationship(  # noqa: F821
        back_populates="video"
    )

    __table_args__ = (
        Index("ix_videos_title", "title"),
        Index("ix_videos_artist_id", "artist_id"),
        Index("ix_videos_file_created_at", "file_created_at"),
    )
