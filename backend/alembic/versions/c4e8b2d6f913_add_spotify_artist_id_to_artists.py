"""add_spotify_artist_id_to_artists

Revision ID: c4e8b2d6f913
Revises: a7d3c9e1f504
Create Date: 2026-11-27 22:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c4e8b2d6f913"
down_revision: Union[str, None] = "a7d3c9e1f504"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("artists", sa.Column("spotify_artist_id", sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column("artists", "spotify_artist_id")
