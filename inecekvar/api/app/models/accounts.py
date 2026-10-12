import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, Timestamps, UUIDPrimaryKey
from app.models.enums import (
    DeletionState,
    MagicLinkPurpose,
    RefreshRevokeReason,
    UserRole,
    enum_check,
)


class User(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("email = lower(email)", name="email_lowercase"),
        CheckConstraint("position('@' in email) > 1", name="email_address"),
        CheckConstraint(
            "password_hash IS NULL OR password_hash LIKE '$argon2id$%'",
            name="password_hash_format",
        ),
        CheckConstraint("reputation >= 0", name="reputation_nonnegative"),
        enum_check("role", UserRole),
        UniqueConstraint("email"),
    )

    email: Mapped[str] = mapped_column(String(320), nullable=False)
    email_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(60), nullable=True)
    role: Mapped[str] = mapped_column(String(32), nullable=False, server_default=text("'user'"))
    reputation: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    licence_accepted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    totp_secret_enc: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class UserSession(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "sessions"
    __table_args__ = (
        CheckConstraint("octet_length(token_hash) = 32", name="token_hash_length"),
        CheckConstraint("expires_at > created_at", name="expiry_after_creation"),
        UniqueConstraint("token_hash"),
        Index("ix_sessions_user_id", "user_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RefreshToken(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "refresh_tokens"
    __table_args__ = (
        CheckConstraint("octet_length(token_hash) = 32", name="token_hash_length"),
        CheckConstraint("(revoked_at IS NULL) = (revoked_reason IS NULL)", name="revocation_pair"),
        CheckConstraint("expires_at > created_at", name="expiry_after_creation"),
        enum_check("revoked_reason", RefreshRevokeReason, nullable=True),
        UniqueConstraint("token_hash"),
        Index("ix_refresh_tokens_family_id", "family_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    family_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("refresh_tokens.id", ondelete="SET NULL"),
        nullable=True,
    )
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)


class MagicLink(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "magic_links"
    __table_args__ = (
        CheckConstraint("email = lower(email)", name="email_lowercase"),
        CheckConstraint("octet_length(token_hash) = 32", name="token_hash_length"),
        CheckConstraint("expires_at > created_at", name="expiry_after_creation"),
        CheckConstraint(
            "password_hash IS NULL OR password_hash LIKE '$argon2id$%'",
            name="password_hash_format",
        ),
        CheckConstraint(
            "purpose = 'register' OR password_hash IS NULL",
            name="password_only_for_register",
        ),
        enum_check("purpose", MagicLinkPurpose),
        UniqueConstraint("token_hash"),
        Index("ix_magic_links_email", "email"),
    )

    email: Mapped[str] = mapped_column(String(320), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
    )
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # A registration is held on its link until the mailbox owner confirms it; no unverified
    # user row exists (ADR-0007).
    purpose: Mapped[str] = mapped_column(String(16), nullable=False, server_default=text("'login'"))
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)


class Favorite(Base):
    __tablename__ = "favorites"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    )
    line_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("lines.id", ondelete="RESTRICT"),
        primary_key=True,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )


class DeletionRequest(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "deletion_requests"
    __table_args__ = (
        enum_check("state", DeletionState),
        Index(
            "uq_deletion_requests_scheduled_user",
            "user_id",
            unique=True,
            postgresql_where=text("state = 'scheduled'"),
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    state: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        server_default=text("'scheduled'"),
    )
    scheduled_for: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
