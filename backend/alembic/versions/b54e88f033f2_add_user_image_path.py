"""add_user_image_path

Revision ID: b54e88f033f2
Revises: 84dc6a668cf4
Create Date: 2026-02-20 16:45:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b54e88f033f2"
down_revision: Union[str, None] = "84dc6a668cf4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("image_path", sa.String(length=1000), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "image_path")
