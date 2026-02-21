"""add_token_revocation_and_distributed_rate_limit

Revision ID: e8c2d34a1f9b
Revises: d2e5f1a0c9ab
Create Date: 2026-02-21 20:10:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e8c2d34a1f9b"
down_revision: Union[str, None] = "d2e5f1a0c9ab"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "revoked_tokens",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("jti", sa.String(length=128), nullable=False),
        sa.Column("token_type", sa.String(length=16), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "revoked_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("jti"),
    )
    op.create_index(
        "ix_revoked_tokens_expires_at",
        "revoked_tokens",
        ["expires_at"],
        unique=False,
    )
    op.create_index(
        "ix_revoked_tokens_jti",
        "revoked_tokens",
        ["jti"],
        unique=True,
    )

    op.create_table(
        "rate_limit_counters",
        sa.Column("bucket", sa.String(length=64), nullable=False),
        sa.Column("identifier", sa.String(length=128), nullable=False),
        sa.Column("window_start", sa.BigInteger(), nullable=False),
        sa.Column("count", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("bucket", "identifier", "window_start"),
    )
    op.create_index(
        "ix_rate_limit_counters_updated_at",
        "rate_limit_counters",
        ["updated_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_rate_limit_counters_updated_at", table_name="rate_limit_counters")
    op.drop_table("rate_limit_counters")
    op.drop_index("ix_revoked_tokens_jti", table_name="revoked_tokens")
    op.drop_index("ix_revoked_tokens_expires_at", table_name="revoked_tokens")
    op.drop_table("revoked_tokens")
