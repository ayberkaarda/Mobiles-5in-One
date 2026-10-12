import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, Timestamps, UUIDPrimaryKey
from app.models.enums import EditKind, EditState, ModerationState, PhotoKind, enum_check


class Edit(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "edits"
    __table_args__ = (
        CheckConstraint("jsonb_typeof(payload) = 'object'", name="payload_object"),
        CheckConstraint(
            "reviewer_id IS NULL OR author_id IS NULL OR reviewer_id <> author_id",
            name="no_self_review",
        ),
        CheckConstraint(
            "(state IN ('pending','withdrawn')) = (reviewed_at IS NULL)",
            name="reviewed_state",
        ),
        CheckConstraint(
            "kind NOT IN ('update_line','fare_update','retire') OR line_id IS NOT NULL",
            name="line_required",
        ),
        CheckConstraint("kind <> 'update_stop' OR stop_id IS NOT NULL", name="stop_required"),
        enum_check("kind", EditKind),
        enum_check("state", EditState),
        Index("ix_edits_state_created_at", "state", "created_at"),
        Index("ix_edits_author_id", "author_id"),
        Index("ix_edits_line_id", "line_id"),
    )

    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    city_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("cities.id", ondelete="RESTRICT"),
        nullable=False,
    )
    line_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("lines.id", ondelete="RESTRICT"),
        nullable=True,
    )
    stop_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("stops.id", ondelete="RESTRICT"),
        nullable=True,
    )
    payload: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    diff: Mapped[dict[str, object] | list[object] | None] = mapped_column(JSONB, nullable=True)
    state: Mapped[str] = mapped_column(String(32), nullable=False, server_default=text("'pending'"))
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    reason: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    photo_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("photos.id", ondelete="SET NULL"),
        nullable=True,
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Trace(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "traces"
    __table_args__ = (
        CheckConstraint("jsonb_typeof(points) = 'array'", name="points_array"),
        CheckConstraint("jsonb_array_length(points) BETWEEN 2 AND 5000", name="points_count"),
        CheckConstraint("ended_at >= started_at", name="time_order"),
        Index("ix_traces_delete_after", "delete_after"),
        Index("ix_traces_author_id", "author_id"),
        Index("ix_traces_linked_edit_id", "linked_edit_id"),
    )

    author_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    city_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("cities.id", ondelete="RESTRICT"),
        nullable=False,
    )
    points: Mapped[list[object]] = mapped_column(JSONB, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    linked_edit_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("edits.id", ondelete="SET NULL"),
        nullable=True,
    )
    delete_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Photo(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "photos"
    __table_args__ = (
        CheckConstraint("content_type IN ('image/jpeg','image/webp')", name="content_type_allowed"),
        CheckConstraint("byte_size BETWEEN 1 AND 4194304", name="byte_size_bounds"),
        enum_check("kind", PhotoKind),
        enum_check("moderation_state", ModerationState),
        UniqueConstraint("key"),
    )

    owner_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    key: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    moderation_state: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        server_default=text("'pending'"),
    )
    content_type: Mapped[str] = mapped_column(String(32), nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    # Set by the media worker once the upload is re-encoded or quarantined.
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
