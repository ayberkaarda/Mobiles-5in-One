"""TOTP enrolment and session-bound verification."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("totp_enabled_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("totp_last_counter", sa.BigInteger(), nullable=True))
    op.create_check_constraint(
        op.f("ck_users_totp_enabled_requires_secret"),
        "users",
        "totp_enabled_at IS NULL OR totp_secret_enc IS NOT NULL",
    )
    op.create_table(
        "session_step_ups",
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("session_id", name="pk_session_step_ups"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_session_step_ups_user_id_users", ondelete="CASCADE"
        ),
    )
    op.create_index("ix_session_step_ups_user_id", "session_step_ups", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_session_step_ups_user_id", table_name="session_step_ups")
    op.drop_table("session_step_ups")
    op.drop_constraint(op.f("ck_users_totp_enabled_requires_secret"), "users", type_="check")
    op.drop_column("users", "totp_last_counter")
    op.drop_column("users", "totp_enabled_at")
