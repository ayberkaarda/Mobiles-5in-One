"""Declarative action policy and the route-level edit read rule.

can_read_edit permits moderation roles or the stored author; reading an edit has no Action.
ResourceContext must contain stored row values and server time, never request fields.
"""

import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from enum import StrEnum
from types import MappingProxyType
from typing import Final, Literal

from app.core.deps import Principal
from app.core.errors import AUTH_FORBIDDEN, AUTH_REQUIRED, ProblemError
from app.models.enums import EditState, UserRole


class Action(StrEnum):
    PROPOSE_EDIT = "propose_edit"
    EDIT_OWN_PENDING = "edit_own_pending"
    UPLOAD_TRACE = "upload_trace"
    VIEW_TRACE = "view_trace"
    APPROVE_EDIT = "approve_edit"
    REJECT_EDIT = "reject_edit"
    PUBLISH_VERSION = "publish_version"
    ROLLBACK = "rollback"
    RETIRE_LINE = "retire_line"
    MANAGE_USERS = "manage_users"
    EXPORT_ADMIN = "export_admin"


ANONYMOUS: Final = "anonymous"
type Role = UserRole | Literal["anonymous"]
ROLES: Final[tuple[Role, ...]] = (
    ANONYMOUS,
    UserRole.USER,
    UserRole.CONTRIBUTOR,
    UserRole.MODERATOR,
    UserRole.ADMIN,
)


class Condition(StrEnum):
    LICENCE_ACCEPTED = "licence_accepted"
    TRACE_OWNER = "trace_owner"
    EDIT_AUTHOR = "edit_author"
    EDIT_PENDING = "edit_pending"
    NOT_OWN_PROPOSAL = "not_own_proposal"
    TOTP_STEP_UP = "totp_step_up"


@dataclass(frozen=True)
class Allow:
    pass


@dataclass(frozen=True)
class Deny:
    pass


@dataclass(frozen=True)
class AllowIf:
    conditions: frozenset[Condition]


type Rule = Allow | Deny | AllowIf

PERMISSIONS: Final[Mapping[Role, Mapping[Action, Rule]]] = MappingProxyType(
    {
        ANONYMOUS: MappingProxyType(
            {
                Action.PROPOSE_EDIT: Deny(),
                Action.EDIT_OWN_PENDING: Deny(),
                Action.UPLOAD_TRACE: Deny(),
                Action.VIEW_TRACE: Deny(),
                Action.APPROVE_EDIT: Deny(),
                Action.REJECT_EDIT: Deny(),
                Action.PUBLISH_VERSION: Deny(),
                Action.ROLLBACK: Deny(),
                Action.RETIRE_LINE: Deny(),
                Action.MANAGE_USERS: Deny(),
                Action.EXPORT_ADMIN: Deny(),
            }
        ),
        UserRole.USER: MappingProxyType(
            {
                Action.PROPOSE_EDIT: Deny(),
                Action.EDIT_OWN_PENDING: AllowIf(
                    frozenset({Condition.EDIT_AUTHOR, Condition.EDIT_PENDING})
                ),
                Action.UPLOAD_TRACE: Deny(),
                Action.VIEW_TRACE: AllowIf(frozenset({Condition.TRACE_OWNER})),
                Action.APPROVE_EDIT: Deny(),
                Action.REJECT_EDIT: Deny(),
                Action.PUBLISH_VERSION: Deny(),
                Action.ROLLBACK: Deny(),
                Action.RETIRE_LINE: Deny(),
                Action.MANAGE_USERS: Deny(),
                Action.EXPORT_ADMIN: Deny(),
            }
        ),
        UserRole.CONTRIBUTOR: MappingProxyType(
            {
                Action.PROPOSE_EDIT: AllowIf(frozenset({Condition.LICENCE_ACCEPTED})),
                Action.EDIT_OWN_PENDING: AllowIf(
                    frozenset({Condition.EDIT_AUTHOR, Condition.EDIT_PENDING})
                ),
                Action.UPLOAD_TRACE: AllowIf(frozenset({Condition.LICENCE_ACCEPTED})),
                Action.VIEW_TRACE: AllowIf(frozenset({Condition.TRACE_OWNER})),
                Action.APPROVE_EDIT: Deny(),
                Action.REJECT_EDIT: Deny(),
                Action.PUBLISH_VERSION: Deny(),
                Action.ROLLBACK: Deny(),
                Action.RETIRE_LINE: Deny(),
                Action.MANAGE_USERS: Deny(),
                Action.EXPORT_ADMIN: Deny(),
            }
        ),
        UserRole.MODERATOR: MappingProxyType(
            {
                Action.PROPOSE_EDIT: AllowIf(frozenset({Condition.LICENCE_ACCEPTED})),
                Action.EDIT_OWN_PENDING: AllowIf(
                    frozenset({Condition.EDIT_AUTHOR, Condition.EDIT_PENDING})
                ),
                Action.UPLOAD_TRACE: AllowIf(frozenset({Condition.LICENCE_ACCEPTED})),
                Action.VIEW_TRACE: Allow(),
                Action.APPROVE_EDIT: AllowIf(
                    frozenset({Condition.EDIT_PENDING, Condition.NOT_OWN_PROPOSAL})
                ),
                Action.REJECT_EDIT: AllowIf(
                    frozenset({Condition.EDIT_PENDING, Condition.NOT_OWN_PROPOSAL})
                ),
                Action.PUBLISH_VERSION: AllowIf(
                    frozenset({Condition.EDIT_PENDING, Condition.NOT_OWN_PROPOSAL})
                ),
                Action.ROLLBACK: AllowIf(frozenset({Condition.TOTP_STEP_UP})),
                Action.RETIRE_LINE: AllowIf(frozenset({Condition.TOTP_STEP_UP})),
                Action.MANAGE_USERS: Deny(),
                Action.EXPORT_ADMIN: Deny(),
            }
        ),
        UserRole.ADMIN: MappingProxyType(
            {
                Action.PROPOSE_EDIT: AllowIf(frozenset({Condition.LICENCE_ACCEPTED})),
                Action.EDIT_OWN_PENDING: AllowIf(
                    frozenset({Condition.EDIT_AUTHOR, Condition.EDIT_PENDING})
                ),
                Action.UPLOAD_TRACE: AllowIf(frozenset({Condition.LICENCE_ACCEPTED})),
                Action.VIEW_TRACE: Allow(),
                Action.APPROVE_EDIT: AllowIf(
                    frozenset({Condition.EDIT_PENDING, Condition.NOT_OWN_PROPOSAL})
                ),
                Action.REJECT_EDIT: AllowIf(
                    frozenset({Condition.EDIT_PENDING, Condition.NOT_OWN_PROPOSAL})
                ),
                Action.PUBLISH_VERSION: AllowIf(
                    frozenset({Condition.EDIT_PENDING, Condition.NOT_OWN_PROPOSAL})
                ),
                Action.ROLLBACK: AllowIf(frozenset({Condition.TOTP_STEP_UP})),
                Action.RETIRE_LINE: AllowIf(frozenset({Condition.TOTP_STEP_UP})),
                Action.MANAGE_USERS: AllowIf(frozenset({Condition.TOTP_STEP_UP})),
                Action.EXPORT_ADMIN: AllowIf(frozenset({Condition.TOTP_STEP_UP})),
            }
        ),
    }
)


@dataclass(frozen=True, slots=True)
class ResourceContext:
    actor_id: uuid.UUID | None
    trace_owner_id: uuid.UUID | None = None
    edit_author_id: uuid.UUID | None = None
    edit_state: EditState | None = None
    licence_accepted_at: datetime | None = None
    step_up_at: datetime | None = None
    now: datetime | None = None


STEP_UP_TTL: Final = timedelta(minutes=15)


def licence_accepted(context: ResourceContext) -> bool:
    return context.licence_accepted_at is not None


def trace_owner(context: ResourceContext) -> bool:
    return (
        context.actor_id is not None
        and context.trace_owner_id is not None
        and context.actor_id == context.trace_owner_id
    )


def edit_author(context: ResourceContext) -> bool:
    return (
        context.actor_id is not None
        and context.edit_author_id is not None
        and context.actor_id == context.edit_author_id
    )


def edit_pending(context: ResourceContext) -> bool:
    return context.edit_state == EditState.PENDING


def not_own_proposal(context: ResourceContext) -> bool:
    return (
        context.actor_id is not None
        and context.edit_author_id is not None
        and context.actor_id != context.edit_author_id
    )


def totp_step_up(context: ResourceContext) -> bool:
    if context.step_up_at is None or context.now is None:
        return False
    try:
        return timedelta(0) <= context.now - context.step_up_at <= STEP_UP_TTL
    except TypeError:
        return False


PREDICATES: Final[Mapping[Condition, Callable[[ResourceContext], bool]]] = MappingProxyType(
    {
        Condition.LICENCE_ACCEPTED: licence_accepted,
        Condition.TRACE_OWNER: trace_owner,
        Condition.EDIT_AUTHOR: edit_author,
        Condition.EDIT_PENDING: edit_pending,
        Condition.NOT_OWN_PROPOSAL: not_own_proposal,
        Condition.TOTP_STEP_UP: totp_step_up,
    }
)


def decide(role: Role, action: Action, context: ResourceContext) -> bool:
    row = PERMISSIONS.get(role)
    rule = row.get(action) if row is not None else None
    if isinstance(rule, Allow):
        return True
    if isinstance(rule, AllowIf):
        return all(PREDICATES[condition](context) for condition in rule.conditions)
    return False


def authorize(principal: Principal | None, action: Action, context: ResourceContext) -> None:
    role: Role = ANONYMOUS if principal is None else principal.role
    context = replace(context, actor_id=None if principal is None else principal.user_id)
    if decide(role, action, context):
        return
    if principal is None and isinstance(PERMISSIONS[ANONYMOUS].get(action), Deny):
        raise ProblemError(AUTH_REQUIRED, 401)
    raise ProblemError(AUTH_FORBIDDEN, 403)


def cell(role: Role, action: Action) -> str:
    row = PERMISSIONS.get(role)
    rule = row.get(action) if row is not None else None
    if isinstance(rule, Allow):
        return "allow"
    if isinstance(rule, AllowIf):
        return "allow-if:" + "+".join(sorted(rule.conditions))
    return "deny"


def can_read_edit(principal: Principal | None, author_id: uuid.UUID | None) -> bool:
    return principal is not None and (
        principal.role in {UserRole.MODERATOR, UserRole.ADMIN}
        or (author_id is not None and principal.user_id == author_id)
    )
