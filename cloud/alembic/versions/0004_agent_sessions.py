"""agent_sessions: 跨 worker 共享的短期 Agent 会话历史表

Revision ID: 0004_agent_sessions
Revises: 0003_rate_limit_events
Create Date: 2026-08-19

消息正文只存于 JSONB 列，绝不写日志；按 user_id + session_id 隔离，
由应用侧负责容量截断与过期清理。
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0004_agent_sessions"
down_revision = "0003_rate_limit_events"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "agent_sessions",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("session_id", sa.String(length=80), nullable=False),
        sa.Column("messages", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "user_id", "session_id", name="uq_agent_sessions_user_session"
        ),
    )
    op.create_index("ix_agent_sessions_user_id", "agent_sessions", ["user_id"])
    op.create_index("ix_agent_sessions_updated_at", "agent_sessions", ["updated_at"])


def downgrade() -> None:
    op.drop_index("ix_agent_sessions_updated_at", table_name="agent_sessions")
    op.drop_index("ix_agent_sessions_user_id", table_name="agent_sessions")
    op.drop_table("agent_sessions")
