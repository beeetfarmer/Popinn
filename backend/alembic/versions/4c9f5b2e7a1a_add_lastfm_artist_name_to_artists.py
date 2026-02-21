"""add_lastfm_artist_name_to_artists

Revision ID: 4c9f5b2e7a1a
Revises: 1d9e2f4b7c11
Create Date: 2026-02-21 22:15:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "4c9f5b2e7a1a"
down_revision: Union[str, None] = "1d9e2f4b7c11"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "artists",
        sa.Column("lastfm_artist_name", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("artists", "lastfm_artist_name")
