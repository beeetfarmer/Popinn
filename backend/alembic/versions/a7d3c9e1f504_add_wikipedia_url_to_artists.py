"""add_wikipedia_url_to_artists

Revision ID: a7d3c9e1f504
Revises: f3a71c4d8b02
Create Date: 2026-11-27 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a7d3c9e1f504"
down_revision: Union[str, None] = "f3a71c4d8b02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("artists", sa.Column("wikipedia_url", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("artists", "wikipedia_url")
