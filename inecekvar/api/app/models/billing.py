import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
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
        Index("ix_subscriptions_rc_app_user_id", "rc_app_user_id"),
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
    # Provider time of the newest event or snapshot applied to this row; older events are
    # stale and change nothing (out-of-order delivery).
    last_event_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


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


class PackDownloadStat(UUIDPrimaryKey, Timestamps, Base):
    """Downloads per city and day, kept after the per-identity rows pass their retention."""

    __tablename__ = "pack_download_stats"
    __table_args__ = (
        CheckConstraint("downloads >= 0", name="downloads_non_negative"),
        UniqueConstraint("city_id", "day"),
    )

    city_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("cities.id", ondelete="RESTRICT"),
        nullable=False,
    )
    day: Mapped[date] = mapped_column(Date, nullable=False)
    downloads: Mapped[int] = mapped_column(Integer, nullable=False)
