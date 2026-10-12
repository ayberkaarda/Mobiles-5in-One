from enum import StrEnum

from sqlalchemy import CheckConstraint


class LineMode(StrEnum):
    DOLMUS = "dolmus"
    MINIBUS = "minibus"
    SERVIS = "servis"


class LineStatus(StrEnum):
    DRAFT = "draft"
    PUBLISHED = "published"
    RETIRED = "retired"


class StopKind(StrEnum):
    FORMAL = "formal"
    INFORMAL = "informal"


class StopStatus(StrEnum):
    ACTIVE = "active"
    RETIRED = "retired"


class EditKind(StrEnum):
    NEW_LINE = "new_line"
    UPDATE_LINE = "update_line"
    NEW_STOP = "new_stop"
    UPDATE_STOP = "update_stop"
    FARE_UPDATE = "fare_update"
    RETIRE = "retire"


class EditState(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"


class UserRole(StrEnum):
    USER = "user"
    CONTRIBUTOR = "contributor"
    MODERATOR = "moderator"
    ADMIN = "admin"


class PhotoKind(StrEnum):
    FARE_TABLE = "fare_table"
    STOP_SIGN = "stop_sign"


class ModerationState(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    QUARANTINED = "quarantined"


class SubscriptionStatus(StrEnum):
    ACTIVE = "active"
    GRACE = "grace"
    EXPIRED = "expired"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"


class WebhookOutcome(StrEnum):
    APPLIED = "applied"
    IGNORED = "ignored"
    STALE = "stale"
    FAILED = "failed"


class WebhookProvider(StrEnum):
    REVENUECAT = "revenuecat"
    RESEND = "resend"


class SuppressionReason(StrEnum):
    BOUNCE = "bounce"
    COMPLAINT = "complaint"
    MANUAL = "manual"


class RefreshRevokeReason(StrEnum):
    ROTATED = "rotated"
    REUSE_DETECTED = "reuse_detected"
    LOGOUT = "logout"
    LOGOUT_ALL = "logout_all"
    ACCOUNT_DELETED = "account_deleted"


class MagicLinkPurpose(StrEnum):
    LOGIN = "login"
    REGISTER = "register"


class DeletionState(StrEnum):
    SCHEDULED = "scheduled"
    CANCELLED = "cancelled"
    COMPLETED = "completed"


def enum_check(column: str, enum: type[StrEnum], *, nullable: bool = False) -> CheckConstraint:
    values = ", ".join("'" + value.value + "'" for value in enum)
    expression = column + " IN (" + values + ")"
    if nullable:
        expression = column + " IS NULL OR " + expression
    return CheckConstraint(expression, name=column + "_enum")
