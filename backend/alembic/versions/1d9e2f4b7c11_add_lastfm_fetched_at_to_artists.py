"""add_lastfm_fetched_at_to_artists

Revision ID: 1d9e2f4b7c11
Revises: c1a92be8e4e1
Create Date: 2026-02-21 18:10:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "1d9e2f4b7c11"
down_revision: Union[str, None] = "c1a92be8e4e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "artists",
        sa.Column("lastfm_fetched_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("artists", "lastfm_fetched_at")
