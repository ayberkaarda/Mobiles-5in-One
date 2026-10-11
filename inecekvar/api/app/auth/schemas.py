import unicodedata
import uuid
from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.core.deps import AuthMode
from app.models.accounts import User
from app.models.enums import UserRole

Email = Annotated[EmailStr, Field(max_length=320)]
Password = Annotated[str, Field(min_length=1, max_length=1024)]
OpaqueToken = Annotated[str, Field(min_length=16, max_length=256, pattern=r"^[A-Za-z0-9_-]+$")]


def clean_display_name(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not 1 <= len(value) <= 60 or any(unicodedata.category(c).startswith("C") for c in value):
        raise ValueError("invalid display name")
    return value


class Schema(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RegisterIn(Schema):
    email: Email
    password: Password
    display_name: str | None = None
    mode: AuthMode

    _display_name = field_validator("display_name")(clean_display_name)


class LoginIn(Schema):
    email: Email
    password: Password
    mode: AuthMode


class MagicLinkIn(Schema):
    email: Email


class VerifyIn(Schema):
    token: OpaqueToken
    mode: AuthMode


class RefreshIn(Schema):
    refresh_token: OpaqueToken


class PatchMeIn(Schema):
    display_name: str | None

    _display_name = field_validator("display_name")(clean_display_name)


class DeleteMeIn(Schema):
    password: Password | None = None


class EmptyIn(Schema):
    pass


class StatusOut(Schema):
    status: Literal["check_email", "deletion_scheduled"]


class CsrfOut(Schema):
    csrf_token: str


class MeOut(Schema):
    id: uuid.UUID
    email: str
    display_name: str | None
    role: UserRole
    reputation: int
    email_verified: bool
    licence_accepted: bool
    created_at: datetime

    @classmethod
    def from_user(cls, user: User) -> Self:
        return cls(
            id=user.id,
            email=user.email,
            display_name=user.display_name,
            role=UserRole(user.role),
            reputation=user.reputation,
            email_verified=user.email_verified_at is not None,
            licence_accepted=user.licence_accepted_at is not None,
            created_at=user.created_at,
        )


class CookieOut(Schema):
    user: MeOut
    csrf_token: str
    auth_mode: Literal["cookie"] = "cookie"


class RefreshOut(Schema):
    access_token: str
    token_type: Literal["Bearer"] = "Bearer"  # noqa: S105 (protocol label)
    expires_in: int
    refresh_token: str


class BearerOut(RefreshOut):
    user: MeOut
    auth_mode: Literal["bearer"] = "bearer"
