"""rate_limit_events: 跨 worker 共享滑动窗口限流事件表

Revision ID: 0003_rate_limit_events
Revises: 0002_invite_uses
Create Date: 2026-08-11

"""
from alembic import op
import sqlalchemy as sa

revision = "0003_rate_limit_events"
down_revision = "0002_invite_uses"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rate_limit_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("bucket_key", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_rate_limit_events_bucket_key", "rate_limit_events", ["bucket_key"])
    op.create_index("ix_rate_limit_events_created_at", "rate_limit_events", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_rate_limit_events_created_at", table_name="rate_limit_events")
    op.drop_index("ix_rate_limit_events_bucket_key", table_name="rate_limit_events")
    op.drop_table("rate_limit_events")
