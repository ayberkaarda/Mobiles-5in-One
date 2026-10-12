import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    LargeBinary,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, Timestamps, UUIDPrimaryKey
from app.models.enums import SubscriptionStatus, enum_check


class Subscription(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "subscriptions"
    __table_args__ = (
        enum_check("status", SubscriptionStatus),
        UniqueConstraint("user_id", "product_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    rc_app_user_id: Mapped[str] = mapped_column(String(128), nullable=False)
    product_id: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PackDownload(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "pack_downloads"
    __table_args__ = (
        CheckConstraint(
            "anon_hash IS NULL OR octet_length(anon_hash) = 32",
            name="anon_hash_length",
        ),
        CheckConstraint("user_id IS NOT NULL OR anon_hash IS NOT NULL", name="identity_present"),
        Index("ix_pack_downloads_user_id_day", "user_id", "day"),
        Index("ix_pack_downloads_anon_hash_day", "anon_hash", "day"),
    )

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    anon_hash: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    city_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("cities.id", ondelete="RESTRICT"),
        nullable=False,
    )
    day: Mapped[date] = mapped_column(Date, nullable=False)
