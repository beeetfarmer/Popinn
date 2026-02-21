"""add_video_play_history

Revision ID: 63c254462f23
Revises: b54e88f033f2
Create Date: 2026-02-20 17:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "63c254462f23"
down_revision: Union[str, None] = "b54e88f033f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "video_plays",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("video_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("watched_seconds", sa.Integer(), nullable=False),
        sa.Column("video_duration_seconds", sa.Integer(), nullable=True),
        sa.Column("counted_play", sa.Boolean(), server_default="false", nullable=False),
        sa.Column(
            "played_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["video_id"], ["videos.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_video_plays_video_id", "video_plays", ["video_id"], unique=False)
    op.create_index("ix_video_plays_user_id", "video_plays", ["user_id"], unique=False)
    op.create_index(
        "ix_video_plays_counted_play", "video_plays", ["counted_play"], unique=False
    )
    op.create_index("ix_video_plays_played_at", "video_plays", ["played_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_video_plays_played_at", table_name="video_plays")
    op.drop_index("ix_video_plays_counted_play", table_name="video_plays")
    op.drop_index("ix_video_plays_user_id", table_name="video_plays")
    op.drop_index("ix_video_plays_video_id", table_name="video_plays")
    op.drop_table("video_plays")
