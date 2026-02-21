"""reclassify_views_to_twenty_percent

Revision ID: c1a92be8e4e1
Revises: 0f3b2d9c5a77
Create Date: 2026-02-21 16:25:00.000000

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "c1a92be8e4e1"
down_revision: Union[str, None] = "0f3b2d9c5a77"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE video_plays
        SET counted_play = CASE
            WHEN video_duration_seconds IS NOT NULL
             AND video_duration_seconds > 0
             AND watched_seconds >= (video_duration_seconds * 0.2)
            THEN TRUE
            ELSE FALSE
        END
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE video_plays
        SET counted_play = CASE
            WHEN video_duration_seconds IS NOT NULL
             AND video_duration_seconds > 0
             AND watched_seconds >= (video_duration_seconds * 0.5)
            THEN TRUE
            ELSE FALSE
        END
        """
    )
