import uuid
from datetime import datetime

from geoalchemy2 import Geography, Geometry
from geoalchemy2.elements import WKBElement
from sqlalchemy import (
    Boolean,
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
from app.models.enums import LineMode, LineStatus, StopKind, StopStatus, enum_check


class City(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "cities"
    __table_args__ = (
        CheckConstraint("slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", name="slug_format"),
        CheckConstraint("pack_version >= 0", name="pack_version_nonnegative"),
        CheckConstraint("ST_Contains(bbox, centroid)", name="centroid_inside_bbox"),
        UniqueConstraint("slug"),
        Index("ix_cities_bbox", "bbox", postgresql_using="gist"),
        Index("ix_cities_centroid", "centroid", postgresql_using="gist"),
    )

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    bbox: Mapped[WKBElement] = mapped_column(
        Geometry("POLYGON", srid=4326, spatial_index=False),
        nullable=False,
    )
    centroid: Mapped[WKBElement] = mapped_column(
        Geometry("POINT", srid=4326, spatial_index=False),
        nullable=False,
    )
    timezone: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        server_default=text("'Europe/Istanbul'"),
    )
    is_sample: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    pack_version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))


class Line(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "lines"
    __table_args__ = (
        CheckConstraint("slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", name="slug_format"),
        CheckConstraint("contributor_count >= 0", name="contributor_count_nonnegative"),
        CheckConstraint(
            "status <> 'published' OR current_version_id IS NOT NULL",
            name="published_version",
        ),
        enum_check("mode", LineMode),
        enum_check("status", LineStatus),
        UniqueConstraint("city_id", "slug"),
        Index("ix_lines_city_id_status", "city_id", "status"),
    )

    city_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("cities.id", ondelete="RESTRICT"),
        nullable=False,
    )
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), nullable=False)
    mode: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, server_default=text("'draft'"))
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("line_versions.id", ondelete="RESTRICT", use_alter=True),
        nullable=True,
    )
    contributor_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("0"),
    )
    last_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )


class LineVersion(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "line_versions"
    __table_args__ = (
        CheckConstraint("version_no >= 1", name="version_positive"),
        CheckConstraint("ST_NPoints(geom) >= 2", name="geom_points"),
        CheckConstraint("ST_IsValid(geom)", name="geom_valid"),
        CheckConstraint("ST_Length(geom::geography) <= 150000", name="geom_length"),
        CheckConstraint(
            "fare_minor IS NULL OR fare_minor BETWEEN 0 AND 10000000",
            name="fare_bounds",
        ),
        CheckConstraint("jsonb_typeof(payment_methods) = 'array'", name="payment_methods_array"),
        CheckConstraint("jsonb_typeof(stop_ids) = 'array'", name="stop_ids_array"),
        UniqueConstraint("line_id", "version_no"),
        Index("ix_line_versions_geom", "geom", postgresql_using="gist"),
    )

    line_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("lines.id", ondelete="RESTRICT"),
        nullable=False,
    )
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    geom: Mapped[WKBElement] = mapped_column(
        Geometry("LINESTRING", srid=4326, spatial_index=False),
        nullable=False,
    )
    fare_minor: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fare_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    hours_text: Mapped[str | None] = mapped_column(String(500), nullable=True)
    payment_methods: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'"),
    )
    hail_notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    stop_ids: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'"),
    )
    source_edit_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("edits.id", ondelete="RESTRICT"),
        nullable=True,
    )
    published_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Stop(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "stops"
    __table_args__ = (
        CheckConstraint("slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", name="slug_format"),
        enum_check("kind", StopKind),
        enum_check("status", StopStatus),
        UniqueConstraint("city_id", "slug"),
        Index("ix_stops_location", "location", postgresql_using="gist"),
    )

    city_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("cities.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), nullable=False)
    location: Mapped[WKBElement] = mapped_column(
        Geography("POINT", srid=4326, spatial_index=False),
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, server_default=text("'active'"))


class LineStop(Base):
    __tablename__ = "line_stops"
    __table_args__ = (
        CheckConstraint("seq >= 0", name="seq_nonnegative"),
        Index("ix_line_stops_stop_id", "stop_id"),
    )

    line_version_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("line_versions.id", ondelete="RESTRICT"),
        primary_key=True,
        nullable=False,
    )
    stop_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("stops.id", ondelete="RESTRICT"),
        nullable=False,
    )
    seq: Mapped[int] = mapped_column(Integer, primary_key=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
