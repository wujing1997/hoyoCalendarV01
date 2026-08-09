"""invites: 增加可用次数字段（权威方案 §5.1：允许次数/已用次数）

Revision ID: 0002_invite_uses
Revises: 0001_initial
Create Date: 2026-08-09

"""
from alembic import op
import sqlalchemy as sa

revision = "0002_invite_uses"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("invite_codes", sa.Column("max_uses", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("invite_codes", sa.Column("use_count", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("invite_codes", "use_count")
    op.drop_column("invite_codes", "max_uses")
