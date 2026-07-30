"""add_file_created_at_and_missing_at_to_videos

Revision ID: f3a71c4d8b02
Revises: e8c2d34a1f9b
Create Date: 2026-07-30 10:00:00.000000

Both columns are nullable with no backfill here on purpose. Their values come
from the filesystem, and a migration runs at container start when the media
volume may not be mounted yet -- reading it here would either fail or, worse,
quietly record wrong dates. The scanner fills file_created_at in for existing
rows on its next pass, and sorting falls back to added_at until it does.

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f3a71c4d8b02"
down_revision: Union[str, None] = "e8c2d34a1f9b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "videos",
        sa.Column("file_created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "videos",
        sa.Column("missing_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_videos_file_created_at",
        "videos",
        ["file_created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_videos_file_created_at", table_name="videos")
    op.drop_column("videos", "missing_at")
    op.drop_column("videos", "file_created_at")
