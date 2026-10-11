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
from app.models.enums import SuppressionReason, WebhookProvider, enum_check


class WebhookEvent(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "webhook_events"
    __table_args__ = (
        enum_check("provider", WebhookProvider),
        UniqueConstraint("provider", "event_id"),
    )

    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    event_id: Mapped[str] = mapped_column(String(255), nullable=False)
    event_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class EmailSuppression(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "email_suppressions"
    __table_args__ = (
        CheckConstraint("octet_length(email_hash) = 32", name="email_hash_length"),
        enum_check("reason", SuppressionReason),
        UniqueConstraint("email_hash"),
    )

    email_hash: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    reason: Mapped[str] = mapped_column(String(32), nullable=False)
    suppressed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )


class AuditLog(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "audit_logs"
    __table_args__ = (
        CheckConstraint(
            "diff_hash IS NULL OR octet_length(diff_hash) = 32",
            name="diff_hash_length",
        ),
        Index("ix_audit_logs_target_type_target_id", "target_type", "target_id"),
        Index("ix_audit_logs_actor_id", "actor_id"),
        Index("ix_audit_logs_created_at", "created_at"),
    )

    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    target_type: Mapped[str] = mapped_column(String(64), nullable=False)
    target_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    diff_hash: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)


class Export(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "exports"
    __table_args__ = (
        CheckConstraint("version >= 1", name="version_positive"),
        UniqueConstraint("city_id", "version"),
    )

    city_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("cities.id", ondelete="RESTRICT"),
        nullable=False,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    path: Mapped[str] = mapped_column(String(512), nullable=False)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
