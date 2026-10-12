import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import cast

import pytest

from app.core.deps import Principal
from app.core.errors import (
    AUTH_FORBIDDEN,
    AUTH_REQUIRED,
    STEP_UP_REQUIRED,
    TOTP_ENROLMENT_REQUIRED,
    ProblemError,
)
from app.models.enums import EditState, UserRole
from app.security.policy import (
    PERMISSIONS,
    PREDICATES,
    ROLES,
    Action,
    AllowIf,
    Condition,
    Deny,
    ResourceContext,
    Role,
    authorize,
    can_read_edit,
    cell,
    decide,
)

EXPECTED: dict[tuple[str, str], str] = {
    ("anonymous", "propose_edit"): "deny",
    ("anonymous", "edit_own_pending"): "deny",
    ("anonymous", "upload_trace"): "deny",
    ("anonymous", "view_trace"): "deny",
    ("anonymous", "approve_edit"): "deny",
    ("anonymous", "reject_edit"): "deny",
    ("anonymous", "publish_version"): "deny",
    ("anonymous", "rollback"): "deny",
    ("anonymous", "retire_line"): "deny",
    ("anonymous", "manage_users"): "deny",
    ("anonymous", "export_admin"): "deny",
    ("user", "propose_edit"): "deny",
    ("user", "edit_own_pending"): "allow-if:edit_author+edit_pending",
    ("user", "upload_trace"): "deny",
    ("user", "view_trace"): "allow-if:trace_owner",
    ("user", "approve_edit"): "deny",
    ("user", "reject_edit"): "deny",
    ("user", "publish_version"): "deny",
    ("user", "rollback"): "deny",
    ("user", "retire_line"): "deny",
    ("user", "manage_users"): "deny",
    ("user", "export_admin"): "deny",
    ("contributor", "propose_edit"): "allow-if:licence_accepted",
    ("contributor", "edit_own_pending"): "allow-if:edit_author+edit_pending",
    ("contributor", "upload_trace"): "allow-if:licence_accepted",
    ("contributor", "view_trace"): "allow-if:trace_owner",
    ("contributor", "approve_edit"): "deny",
    ("contributor", "reject_edit"): "deny",
    ("contributor", "publish_version"): "deny",
    ("contributor", "rollback"): "deny",
    ("contributor", "retire_line"): "deny",
    ("contributor", "manage_users"): "deny",
    ("contributor", "export_admin"): "deny",
    ("moderator", "propose_edit"): "allow-if:licence_accepted",
    ("moderator", "edit_own_pending"): "allow-if:edit_author+edit_pending",
    ("moderator", "upload_trace"): "allow-if:licence_accepted",
    ("moderator", "view_trace"): "allow",
    ("moderator", "approve_edit"): "allow-if:edit_pending+not_own_proposal",
    ("moderator", "reject_edit"): "allow-if:edit_pending+not_own_proposal",
    ("moderator", "publish_version"): "allow-if:edit_pending+not_own_proposal",
    ("moderator", "rollback"): "allow-if:totp_step_up",
    ("moderator", "retire_line"): "allow-if:totp_step_up",
    ("moderator", "manage_users"): "deny",
    ("moderator", "export_admin"): "deny",
    ("admin", "propose_edit"): "allow-if:licence_accepted",
    ("admin", "edit_own_pending"): "allow-if:edit_author+edit_pending",
    ("admin", "upload_trace"): "allow-if:licence_accepted",
    ("admin", "view_trace"): "allow",
    ("admin", "approve_edit"): "allow-if:edit_pending+not_own_proposal",
    ("admin", "reject_edit"): "allow-if:edit_pending+not_own_proposal",
    ("admin", "publish_version"): "allow-if:edit_pending+not_own_proposal",
    ("admin", "rollback"): "allow-if:totp_step_up",
    ("admin", "retire_line"): "allow-if:totp_step_up",
    ("admin", "manage_users"): "allow-if:totp_step_up",
    ("admin", "export_admin"): "allow-if:totp_step_up",
}

NOW = datetime(2026, 10, 12, tzinfo=UTC)
ACTOR = uuid.UUID(int=1)
OTHER = uuid.UUID(int=2)
FULL = ResourceContext(
    actor_id=ACTOR,
    trace_owner_id=ACTOR,
    edit_author_id=ACTOR,
    edit_state=EditState.PENDING,
    licence_accepted_at=NOW,
    step_up_at=NOW,
    totp_enrolled=True,
    now=NOW,
)
CELLS = [(role, action) for role in ROLES for action in Action]
CONDITIONAL = [
    (role, action) for role, action in CELLS if cell(role, action).startswith("allow-if:")
]
DENIED = [(role, action) for role, action in CELLS if cell(role, action) == "deny"]


def cell_id(value: tuple[Role, Action]) -> str:
    return f"{value[0]}-{value[1]}"


@pytest.mark.parametrize(("role", "action"), CELLS, ids=[cell_id(value) for value in CELLS])
def test_every_cell_matches_expected(role: Role, action: Action) -> None:
    assert cell(role, action) == EXPECTED[str(role), str(action)]


def test_table_is_total() -> None:
    assert set(PERMISSIONS) == set(ROLES)
    assert len(EXPECTED) == 55
    for row in PERMISSIONS.values():
        assert set(row) == set(Action)


@pytest.mark.parametrize(
    ("role", "action"), CONDITIONAL, ids=[cell_id(value) for value in CONDITIONAL]
)
def test_decide_allow_if_cells(role: Role, action: Action) -> None:
    rule = PERMISSIONS[role][action]
    assert isinstance(rule, AllowIf)
    context = replace(
        FULL, edit_author_id=OTHER if Condition.NOT_OWN_PROPOSAL in rule.conditions else ACTOR
    )
    broken = {
        Condition.LICENCE_ACCEPTED: replace(context, licence_accepted_at=None),
        Condition.TRACE_OWNER: replace(context, trace_owner_id=OTHER),
        Condition.EDIT_AUTHOR: replace(context, edit_author_id=OTHER),
        Condition.EDIT_PENDING: replace(context, edit_state=EditState.APPROVED),
        Condition.NOT_OWN_PROPOSAL: replace(context, edit_author_id=ACTOR),
        Condition.TOTP_STEP_UP: replace(context, step_up_at=None),
    }
    assert decide(role, action, context)
    for condition in rule.conditions:
        candidate = broken[condition]
        assert not PREDICATES[condition](candidate)
        assert all(PREDICATES[other](candidate) for other in rule.conditions if other != condition)
        assert not decide(role, action, candidate)


@pytest.mark.parametrize(("role", "action"), DENIED, ids=[cell_id(value) for value in DENIED])
def test_deny_cells_deny_even_with_full_context(role: Role, action: Action) -> None:
    # Author and non-author are mutually exclusive; cover both complete variants.
    assert isinstance(PERMISSIONS[role][action], Deny)
    assert not decide(role, action, FULL)
    assert not decide(role, action, replace(FULL, edit_author_id=OTHER))


def test_unknown_action_and_role_denied() -> None:
    assert not decide(cast(Role, "unknown"), Action.VIEW_TRACE, FULL)
    assert not decide(UserRole.ADMIN, cast(Action, "unknown"), FULL)


@pytest.mark.parametrize(
    ("age", "allowed"),
    [(899, True), (900, True), (901, False), (-1, False)],
    ids=["14:59", "15:00", "15:01", "future"],
)
def test_step_up_window(age: int, allowed: bool) -> None:
    context = replace(FULL, step_up_at=NOW - timedelta(seconds=age))
    assert decide(UserRole.MODERATOR, Action.ROLLBACK, context) is allowed


@pytest.mark.parametrize(
    ("role", "action"),
    [(role, action) for role, action in CELLS if "totp_step_up" in cell(role, action)],
)
@pytest.mark.parametrize(
    ("enrolled", "fresh", "code"),
    [
        (False, False, TOTP_ENROLMENT_REQUIRED),
        (False, True, TOTP_ENROLMENT_REQUIRED),
        (True, False, STEP_UP_REQUIRED),
        (True, True, None),
    ],
)
def test_step_up_denial_codes(
    role: Role, action: Action, enrolled: bool, fresh: bool, code: str | None
) -> None:
    assert isinstance(role, UserRole)
    principal = Principal(ACTOR, role, uuid.UUID(int=3), "bearer")
    context = replace(
        FULL,
        edit_author_id=OTHER,
        totp_enrolled=enrolled,
        step_up_at=NOW if fresh else NOW - timedelta(minutes=16),
    )
    if code is None:
        authorize(principal, action, context)
    else:
        with pytest.raises(ProblemError) as exc:
            authorize(principal, action, context)
        assert (exc.value.status, exc.value.code) == (403, code)


def test_authorize_ignores_supplied_actor_id() -> None:
    principal = Principal(ACTOR, UserRole.USER, uuid.UUID(int=3), "bearer")
    forged = replace(FULL, actor_id=OTHER, trace_owner_id=OTHER)
    with pytest.raises(ProblemError) as exc:
        authorize(principal, Action.VIEW_TRACE, forged)
    assert exc.value.status == 403
    authorize(principal, Action.VIEW_TRACE, replace(FULL, actor_id=OTHER))


def test_authorize_anonymous_is_401_and_forbidden_is_403() -> None:
    with pytest.raises(ProblemError) as exc:
        authorize(None, Action.VIEW_TRACE, FULL)
    assert (exc.value.status, exc.value.code) == (401, AUTH_REQUIRED)
    principal = Principal(ACTOR, UserRole.CONTRIBUTOR, uuid.UUID(int=3), "bearer")
    with pytest.raises(ProblemError) as exc:
        authorize(principal, Action.APPROVE_EDIT, replace(FULL, edit_author_id=OTHER))
    assert (exc.value.status, exc.value.code) == (403, AUTH_FORBIDDEN)


def test_matrix_document_matches_table() -> None:
    path = Path(__file__).resolve().parents[3] / "docs/security/authorization-matrix.md"
    section = path.read_text(encoding="utf-8").split("## Policy table\n", 1)[1]
    section = section.split("## API routes\n", 1)[0]
    rows = [line for line in section.splitlines() if line.startswith("|")]
    assert [value.strip() for value in rows[0].strip("|").split("|")] == [
        "Action",
        *map(str, ROLES),
    ]
    actual: dict[tuple[str, str], str] = {}
    actions: list[str] = []
    for line in rows[2:]:
        action, *values = [value.strip() for value in line.strip("|").split("|")]
        assert len(values) == len(ROLES)
        actions.append(action)
        for role, value in zip(ROLES, values, strict=True):
            actual[str(role), action] = value
    assert actions == [action.value for action in Action]
    assert actual == {(str(role), action.value): cell(role, action) for role, action in CELLS}


@pytest.mark.parametrize("condition", list(Condition))
def test_missing_context_denies_predicate(condition: Condition) -> None:
    assert not PREDICATES[condition](ResourceContext(actor_id=None))


@pytest.mark.parametrize("role", list(UserRole))
def test_can_read_edit(role: UserRole) -> None:
    principal = Principal(ACTOR, role, uuid.UUID(int=3), "bearer")
    assert can_read_edit(principal, ACTOR)
    assert can_read_edit(principal, OTHER) is (role in {UserRole.MODERATOR, UserRole.ADMIN})
    assert can_read_edit(principal, None) is (role in {UserRole.MODERATOR, UserRole.ADMIN})
    assert not can_read_edit(None, ACTOR)
