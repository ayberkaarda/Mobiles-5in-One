from enum import StrEnum

import pytest
from sqlalchemy import CheckConstraint

from app.models import Base
from app.models.enums import (
    DeletionState,
    EditKind,
    EditState,
    LineMode,
    LineStatus,
    ModerationState,
    PhotoKind,
    RefreshRevokeReason,
    StopKind,
    StopStatus,
    SubscriptionStatus,
    SuppressionReason,
    UserRole,
    WebhookOutcome,
    WebhookProvider,
)

TABLE_NAMES = {
    "audit_logs",
    "cities",
    "deletion_requests",
    "edits",
    "email_suppressions",
    "exports",
    "favorites",
    "line_stops",
    "line_versions",
    "lines",
    "magic_links",
    "pack_download_stats",
    "pack_downloads",
    "photos",
    "refresh_tokens",
    "sessions",
    "session_step_ups",
    "stops",
    "subscriptions",
    "traces",
    "users",
    "webhook_events",
}


def test_table_set() -> None:
    assert set(Base.metadata.tables) == TABLE_NAMES


def test_common_columns() -> None:
    for name, table in Base.metadata.tables.items():
        if name in {"line_stops", "favorites"}:
            assert "created_at" in table.c
            assert "id" not in table.c
            assert "updated_at" not in table.c
        elif name == "session_step_ups":
            assert {"session_id", "created_at", "updated_at"} <= set(table.c.keys())
            assert "id" not in table.c
        else:
            assert {"id", "created_at", "updated_at"} <= set(table.c.keys())
        assert not table.c.created_at.nullable


def test_named_constraints_and_indexes() -> None:
    for table in Base.metadata.tables.values():
        assert all(constraint.name for constraint in table.constraints)
        assert all(index.name for index in table.indexes)


@pytest.mark.parametrize(
    ("table_name", "column", "enum"),
    [
        ("lines", "mode", LineMode),
        ("lines", "status", LineStatus),
        ("stops", "kind", StopKind),
        ("stops", "status", StopStatus),
        ("users", "role", UserRole),
        ("refresh_tokens", "revoked_reason", RefreshRevokeReason),
        ("deletion_requests", "state", DeletionState),
        ("edits", "kind", EditKind),
        ("edits", "state", EditState),
        ("photos", "kind", PhotoKind),
        ("photos", "moderation_state", ModerationState),
        ("subscriptions", "status", SubscriptionStatus),
        ("webhook_events", "provider", WebhookProvider),
        ("webhook_events", "outcome", WebhookOutcome),
        ("email_suppressions", "reason", SuppressionReason),
    ],
)
def test_enum_checks(table_name: str, column: str, enum: type[StrEnum]) -> None:
    name = "ck_" + table_name + "_" + column + "_enum"
    checks = [
        constraint
        for constraint in Base.metadata.tables[table_name].constraints
        if isinstance(constraint, CheckConstraint) and constraint.name == name
    ]
    assert len(checks) == 1
    expression = str(checks[0].sqltext)
    assert all("'" + value.value + "'" in expression for value in enum)
