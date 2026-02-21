"""add_scan_job_progress_fields

Revision ID: 0f3b2d9c5a77
Revises: 63c254462f23
Create Date: 2026-02-21 12:20:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0f3b2d9c5a77"
down_revision: Union[str, None] = "63c254462f23"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("scan_jobs", sa.Column("folders_total", sa.Integer(), nullable=True))
    op.add_column("scan_jobs", sa.Column("folders_processed", sa.Integer(), nullable=True))
    op.add_column("scan_jobs", sa.Column("current_folder", sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column("scan_jobs", "current_folder")
    op.drop_column("scan_jobs", "folders_processed")
    op.drop_column("scan_jobs", "folders_total")
