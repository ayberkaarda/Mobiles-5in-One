"""Webhook processing state, subscription event ordering and pack download statistics."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

STATUS_BEFORE = "status IN ('active', 'grace', 'expired', 'cancelled')"
STATUS_AFTER = "status IN ('active', 'grace', 'expired', 'cancelled', 'refunded')"
OUTCOME = "outcome IS NULL OR outcome IN ('applied', 'ignored', 'stale', 'failed')"


def upgrade() -> None:
    op.add_column(
        "subscriptions", sa.Column("last_event_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.drop_constraint(op.f("ck_subscriptions_status_enum"), "subscriptions", type_="check")
    op.create_check_constraint(op.f("ck_subscriptions_status_enum"), "subscriptions", STATUS_AFTER)
    op.create_index("ix_subscriptions_rc_app_user_id", "subscriptions", ["rc_app_user_id"])

    op.add_column(
        "webhook_events",
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "webhook_events",
        sa.Column("attempts", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.add_column("webhook_events", sa.Column("outcome", sa.String(length=32), nullable=True))
    op.create_check_constraint(op.f("ck_webhook_events_outcome_enum"), "webhook_events", OUTCOME)
    op.create_check_constraint(
        op.f("ck_webhook_events_attempts_non_negative"), "webhook_events", "attempts >= 0"
    )
    op.create_index("ix_webhook_events_received_at", "webhook_events", ["received_at"])

    op.create_table(
        "pack_download_stats",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("city_id", sa.Uuid(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("downloads", sa.Integer(), nullable=False),
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
        sa.PrimaryKeyConstraint("id", name="pk_pack_download_stats"),
        sa.ForeignKeyConstraint(
            ["city_id"],
            ["cities.id"],
            name="fk_pack_download_stats_city_id_cities",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("city_id", "day", name="uq_pack_download_stats_city_id_day"),
        sa.CheckConstraint(
            "downloads >= 0", name=op.f("ck_pack_download_stats_downloads_non_negative")
        ),
    )


def downgrade() -> None:
    op.drop_table("pack_download_stats")
    op.drop_index("ix_webhook_events_received_at", table_name="webhook_events")
    op.drop_constraint(
        op.f("ck_webhook_events_attempts_non_negative"), "webhook_events", type_="check"
    )
    op.drop_constraint(op.f("ck_webhook_events_outcome_enum"), "webhook_events", type_="check")
    op.drop_column("webhook_events", "outcome")
    op.drop_column("webhook_events", "attempts")
    op.drop_column("webhook_events", "payload")
    op.drop_index("ix_subscriptions_rc_app_user_id", table_name="subscriptions")
    op.execute("UPDATE subscriptions SET status = 'expired' WHERE status = 'refunded'")
    op.drop_constraint(op.f("ck_subscriptions_status_enum"), "subscriptions", type_="check")
    op.create_check_constraint(op.f("ck_subscriptions_status_enum"), "subscriptions", STATUS_BEFORE)
    op.drop_column("subscriptions", "last_event_at")
