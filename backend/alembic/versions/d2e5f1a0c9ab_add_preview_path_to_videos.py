"""add_preview_path_to_videos

Revision ID: d2e5f1a0c9ab
Revises: 4c9f5b2e7a1a
Create Date: 2026-02-21 17:45:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d2e5f1a0c9ab"
down_revision: Union[str, None] = "4c9f5b2e7a1a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "videos",
        sa.Column("preview_path", sa.String(length=1000), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("videos", "preview_path")
