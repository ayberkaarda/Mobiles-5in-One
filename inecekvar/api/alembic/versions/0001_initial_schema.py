"""Initial relational and spatial schema."""

from collections.abc import Sequence

import geoalchemy2
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.create_table(
        "cities",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("slug", sa.String(80), nullable=False),
        sa.Column(
            "bbox",
            geoalchemy2.Geometry("POLYGON", srid=4326, spatial_index=False),
            nullable=False,
        ),
        sa.Column(
            "centroid",
            geoalchemy2.Geometry("POINT", srid=4326, spatial_index=False),
            nullable=False,
        ),
        sa.Column(
            "timezone",
            sa.String(64),
            nullable=False,
            server_default=sa.text("'Europe/Istanbul'"),
        ),
        sa.Column("is_sample", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("pack_version", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_cities"),
        sa.UniqueConstraint("slug", name="uq_cities_slug"),
        sa.CheckConstraint("slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", name=op.f("ck_cities_slug_format")),
        sa.CheckConstraint("pack_version >= 0", name=op.f("ck_cities_pack_version_nonnegative")),
        sa.CheckConstraint(
            "ST_Contains(bbox, centroid)",
            name=op.f("ck_cities_centroid_inside_bbox"),
        ),
    )
    op.create_index("ix_cities_bbox", "cities", ["bbox"], postgresql_using="gist")
    op.create_index("ix_cities_centroid", "cities", ["centroid"], postgresql_using="gist")
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("password_hash", sa.String(255), nullable=True),
        sa.Column("display_name", sa.String(60), nullable=True),
        sa.Column("role", sa.String(32), nullable=False, server_default=sa.text("'user'")),
        sa.Column("reputation", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("licence_accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("totp_secret_enc", sa.LargeBinary(), nullable=True),
        sa.Column("deactivated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        sa.UniqueConstraint("email", name="uq_users_email"),
        sa.CheckConstraint("email = lower(email)", name=op.f("ck_users_email_lowercase")),
        sa.CheckConstraint("position('@' in email) > 1", name=op.f("ck_users_email_address")),
        sa.CheckConstraint(
            "password_hash IS NULL OR password_hash LIKE '$argon2id$%'",
            name=op.f("ck_users_password_hash_format"),
        ),
        sa.CheckConstraint("reputation >= 0", name=op.f("ck_users_reputation_nonnegative")),
        sa.CheckConstraint(
            "role IN ('user', 'contributor', 'moderator', 'admin')",
            name=op.f("ck_users_role_enum"),
        ),
    )
    op.create_table(
        "lines",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("city_id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("slug", sa.String(120), nullable=False),
        sa.Column("mode", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default=sa.text("'draft'")),
        sa.Column("current_version_id", sa.Uuid(), nullable=True),
        sa.Column("contributor_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("last_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_lines"),
        sa.ForeignKeyConstraint(
            ["city_id"],
            ["cities.id"],
            name="fk_lines_city_id_cities",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("city_id", "slug", name="uq_lines_city_id_slug"),
        sa.CheckConstraint("slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", name=op.f("ck_lines_slug_format")),
        sa.CheckConstraint(
            "contributor_count >= 0",
            name=op.f("ck_lines_contributor_count_nonnegative"),
        ),
        sa.CheckConstraint(
            "status <> 'published' OR current_version_id IS NOT NULL",
            name=op.f("ck_lines_published_version"),
        ),
        sa.CheckConstraint(
            "mode IN ('dolmus', 'minibus', 'servis')",
            name=op.f("ck_lines_mode_enum"),
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'published', 'retired')",
            name=op.f("ck_lines_status_enum"),
        ),
    )
    op.create_index("ix_lines_city_id_status", "lines", ["city_id", "status"])
    op.create_table(
        "stops",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("city_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("slug", sa.String(120), nullable=False),
        sa.Column(
            "location",
            geoalchemy2.Geography("POINT", srid=4326, spatial_index=False),
            nullable=False,
        ),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default=sa.text("'active'")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_stops"),
        sa.ForeignKeyConstraint(
            ["city_id"],
            ["cities.id"],
            name="fk_stops_city_id_cities",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("city_id", "slug", name="uq_stops_city_id_slug"),
        sa.CheckConstraint("slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", name=op.f("ck_stops_slug_format")),
        sa.CheckConstraint("kind IN ('formal', 'informal')", name=op.f("ck_stops_kind_enum")),
        sa.CheckConstraint("status IN ('active', 'retired')", name=op.f("ck_stops_status_enum")),
    )
    op.create_index("ix_stops_location", "stops", ["location"], postgresql_using="gist")
    op.create_table(
        "photos",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.String(255), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column(
            "moderation_state",
            sa.String(32),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column("content_type", sa.String(32), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_photos"),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["users.id"],
            name="fk_photos_owner_id_users",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("key", name="uq_photos_key"),
        sa.CheckConstraint(
            "content_type IN ('image/jpeg','image/webp')",
            name=op.f("ck_photos_content_type_allowed"),
        ),
        sa.CheckConstraint(
            "byte_size BETWEEN 1 AND 4194304",
            name=op.f("ck_photos_byte_size_bounds"),
        ),
        sa.CheckConstraint("kind IN ('fare_table', 'stop_sign')", name=op.f("ck_photos_kind_enum")),
        sa.CheckConstraint(
            "moderation_state IN ('pending', 'approved', 'rejected', 'quarantined')",
            name=op.f("ck_photos_moderation_state_enum"),
        ),
    )
    op.create_table(
        "edits",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("city_id", sa.Uuid(), nullable=False),
        sa.Column("line_id", sa.Uuid(), nullable=True),
        sa.Column("stop_id", sa.Uuid(), nullable=True),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("diff", postgresql.JSONB(), nullable=True),
        sa.Column("state", sa.String(32), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("author_id", sa.Uuid(), nullable=True),
        sa.Column("reviewer_id", sa.Uuid(), nullable=True),
        sa.Column("reason", sa.String(1000), nullable=True),
        sa.Column("photo_id", sa.Uuid(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_edits"),
        sa.ForeignKeyConstraint(
            ["city_id"],
            ["cities.id"],
            name="fk_edits_city_id_cities",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["line_id"],
            ["lines.id"],
            name="fk_edits_line_id_lines",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["stop_id"],
            ["stops.id"],
            name="fk_edits_stop_id_stops",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["author_id"],
            ["users.id"],
            name="fk_edits_author_id_users",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["reviewer_id"],
            ["users.id"],
            name="fk_edits_reviewer_id_users",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["photo_id"],
            ["photos.id"],
            name="fk_edits_photo_id_photos",
            ondelete="SET NULL",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(payload) = 'object'",
            name=op.f("ck_edits_payload_object"),
        ),
        sa.CheckConstraint(
            "reviewer_id IS NULL OR author_id IS NULL OR reviewer_id <> author_id",
            name=op.f("ck_edits_no_self_review"),
        ),
        sa.CheckConstraint(
            "(state IN ('pending','withdrawn')) = (reviewed_at IS NULL)",
            name=op.f("ck_edits_reviewed_state"),
        ),
        sa.CheckConstraint(
            "kind NOT IN ('update_line','fare_update','retire') OR line_id IS NOT NULL",
            name=op.f("ck_edits_line_required"),
        ),
        sa.CheckConstraint(
            "kind <> 'update_stop' OR stop_id IS NOT NULL",
            name=op.f("ck_edits_stop_required"),
        ),
        sa.CheckConstraint(
            "kind IN ('new_line', 'update_line', 'new_stop', 'update_stop', "
            "'fare_update', 'retire')",
            name=op.f("ck_edits_kind_enum"),
        ),
        sa.CheckConstraint(
            "state IN ('pending', 'approved', 'rejected', 'withdrawn')",
            name=op.f("ck_edits_state_enum"),
        ),
    )
    op.create_index("ix_edits_state_created_at", "edits", ["state", "created_at"])
    op.create_index("ix_edits_author_id", "edits", ["author_id"])
    op.create_index("ix_edits_line_id", "edits", ["line_id"])
    op.create_table(
        "line_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("line_id", sa.Uuid(), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column(
            "geom",
            geoalchemy2.Geometry("LINESTRING", srid=4326, spatial_index=False),
            nullable=False,
        ),
        sa.Column("fare_minor", sa.Integer(), nullable=True),
        sa.Column("fare_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("hours_text", sa.String(500), nullable=True),
        sa.Column(
            "payment_methods",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
        sa.Column("hail_notes", sa.String(1000), nullable=True),
        sa.Column("stop_ids", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("source_edit_id", sa.Uuid(), nullable=True),
        sa.Column("published_by", sa.Uuid(), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_line_versions"),
        sa.ForeignKeyConstraint(
            ["line_id"],
            ["lines.id"],
            name="fk_line_versions_line_id_lines",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["source_edit_id"],
            ["edits.id"],
            name="fk_line_versions_source_edit_id_edits",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["published_by"],
            ["users.id"],
            name="fk_line_versions_published_by_users",
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint("line_id", "version_no", name="uq_line_versions_line_id_version_no"),
        sa.CheckConstraint("version_no >= 1", name=op.f("ck_line_versions_version_positive")),
        sa.CheckConstraint("ST_NPoints(geom) >= 2", name=op.f("ck_line_versions_geom_points")),
        sa.CheckConstraint("ST_IsValid(geom)", name=op.f("ck_line_versions_geom_valid")),
        sa.CheckConstraint(
            "ST_Length(geom::geography) <= 150000",
            name=op.f("ck_line_versions_geom_length"),
        ),
        sa.CheckConstraint(
            "fare_minor IS NULL OR fare_minor BETWEEN 0 AND 10000000",
            name=op.f("ck_line_versions_fare_bounds"),
        ),
        sa.CheckConstraint(
            "jsonb_typeof(payment_methods) = 'array'",
            name=op.f("ck_line_versions_payment_methods_array"),
        ),
        sa.CheckConstraint(
            "jsonb_typeof(stop_ids) = 'array'",
            name=op.f("ck_line_versions_stop_ids_array"),
        ),
    )
    op.create_index("ix_line_versions_geom", "line_versions", ["geom"], postgresql_using="gist")
    op.create_table(
        "line_stops",
        sa.Column("line_version_id", sa.Uuid(), nullable=False),
        sa.Column("stop_id", sa.Uuid(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("line_version_id", "seq", name="pk_line_stops"),
        sa.ForeignKeyConstraint(
            ["line_version_id"],
            ["line_versions.id"],
            name="fk_line_stops_line_version_id_line_versions",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["stop_id"],
            ["stops.id"],
            name="fk_line_stops_stop_id_stops",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("seq >= 0", name=op.f("ck_line_stops_seq_nonnegative")),
    )
    op.create_index("ix_line_stops_stop_id", "line_stops", ["stop_id"])
    op.create_table(
        "sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.LargeBinary(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_sessions"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_sessions_user_id_users",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("token_hash", name="uq_sessions_token_hash"),
        sa.CheckConstraint(
            "octet_length(token_hash) = 32",
            name=op.f("ck_sessions_token_hash_length"),
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name=op.f("ck_sessions_expiry_after_creation"),
        ),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("token_hash", sa.LargeBinary(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_reason", sa.String(32), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_refresh_tokens"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_refresh_tokens_user_id_users",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["parent_id"],
            ["refresh_tokens.id"],
            name="fk_refresh_tokens_parent_id_refresh_tokens",
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint("token_hash", name="uq_refresh_tokens_token_hash"),
        sa.CheckConstraint(
            "octet_length(token_hash) = 32",
            name=op.f("ck_refresh_tokens_token_hash_length"),
        ),
        sa.CheckConstraint(
            "(revoked_at IS NULL) = (revoked_reason IS NULL)",
            name=op.f("ck_refresh_tokens_revocation_pair"),
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name=op.f("ck_refresh_tokens_expiry_after_creation"),
        ),
        sa.CheckConstraint(
            "revoked_reason IS NULL OR revoked_reason IN "
            "('rotated', 'reuse_detected', 'logout', 'logout_all', 'account_deleted')",
            name=op.f("ck_refresh_tokens_revoked_reason_enum"),
        ),
    )
    op.create_index("ix_refresh_tokens_family_id", "refresh_tokens", ["family_id"])
    op.create_table(
        "magic_links",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("token_hash", sa.LargeBinary(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_magic_links"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_magic_links_user_id_users",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("token_hash", name="uq_magic_links_token_hash"),
        sa.CheckConstraint("email = lower(email)", name=op.f("ck_magic_links_email_lowercase")),
        sa.CheckConstraint(
            "octet_length(token_hash) = 32",
            name=op.f("ck_magic_links_token_hash_length"),
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name=op.f("ck_magic_links_expiry_after_creation"),
        ),
    )
    op.create_index("ix_magic_links_email", "magic_links", ["email"])
    op.create_table(
        "favorites",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("line_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("user_id", "line_id", name="pk_favorites"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_favorites_user_id_users",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["line_id"],
            ["lines.id"],
            name="fk_favorites_line_id_lines",
            ondelete="RESTRICT",
        ),
    )
    op.create_table(
        "deletion_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("state", sa.String(32), nullable=False, server_default=sa.text("'scheduled'")),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=False),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_deletion_requests"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_deletion_requests_user_id_users",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "state IN ('scheduled', 'cancelled', 'completed')",
            name=op.f("ck_deletion_requests_state_enum"),
        ),
    )
    op.create_index(
        "uq_deletion_requests_scheduled_user",
        "deletion_requests",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("state = 'scheduled'"),
    )
    op.create_table(
        "traces",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("author_id", sa.Uuid(), nullable=False),
        sa.Column("city_id", sa.Uuid(), nullable=False),
        sa.Column("points", postgresql.JSONB(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("linked_edit_id", sa.Uuid(), nullable=True),
        sa.Column("delete_after", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_traces"),
        sa.ForeignKeyConstraint(
            ["author_id"],
            ["users.id"],
            name="fk_traces_author_id_users",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["city_id"],
            ["cities.id"],
            name="fk_traces_city_id_cities",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["linked_edit_id"],
            ["edits.id"],
            name="fk_traces_linked_edit_id_edits",
            ondelete="SET NULL",
        ),
        sa.CheckConstraint("jsonb_typeof(points) = 'array'", name=op.f("ck_traces_points_array")),
        sa.CheckConstraint(
            "jsonb_array_length(points) BETWEEN 2 AND 5000",
            name=op.f("ck_traces_points_count"),
        ),
        sa.CheckConstraint("ended_at >= started_at", name=op.f("ck_traces_time_order")),
    )
    op.create_index("ix_traces_delete_after", "traces", ["delete_after"])
    op.create_index("ix_traces_author_id", "traces", ["author_id"])
    op.create_table(
        "subscriptions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("rc_app_user_id", sa.String(128), nullable=False),
        sa.Column("product_id", sa.String(128), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_subscriptions"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_subscriptions_user_id_users",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("user_id", "product_id", name="uq_subscriptions_user_id_product_id"),
        sa.CheckConstraint(
            "status IN ('active', 'grace', 'expired', 'cancelled')",
            name=op.f("ck_subscriptions_status_enum"),
        ),
    )
    op.create_table(
        "pack_downloads",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("anon_hash", sa.LargeBinary(), nullable=True),
        sa.Column("city_id", sa.Uuid(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_pack_downloads"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_pack_downloads_user_id_users",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["city_id"],
            ["cities.id"],
            name="fk_pack_downloads_city_id_cities",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "anon_hash IS NULL OR octet_length(anon_hash) = 32",
            name=op.f("ck_pack_downloads_anon_hash_length"),
        ),
        sa.CheckConstraint(
            "user_id IS NOT NULL OR anon_hash IS NOT NULL",
            name=op.f("ck_pack_downloads_identity_present"),
        ),
    )
    op.create_index("ix_pack_downloads_user_id_day", "pack_downloads", ["user_id", "day"])
    op.create_index("ix_pack_downloads_anon_hash_day", "pack_downloads", ["anon_hash", "day"])
    op.create_table(
        "webhook_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("event_id", sa.String(255), nullable=False),
        sa.Column("event_type", sa.String(128), nullable=True),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_webhook_events"),
        sa.UniqueConstraint("provider", "event_id", name="uq_webhook_events_provider_event_id"),
        sa.CheckConstraint(
            "provider IN ('revenuecat', 'resend')",
            name=op.f("ck_webhook_events_provider_enum"),
        ),
    )
    op.create_table(
        "email_suppressions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email_hash", sa.LargeBinary(), nullable=False),
        sa.Column("reason", sa.String(32), nullable=False),
        sa.Column(
            "suppressed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_email_suppressions"),
        sa.UniqueConstraint("email_hash", name="uq_email_suppressions_email_hash"),
        sa.CheckConstraint(
            "octet_length(email_hash) = 32",
            name=op.f("ck_email_suppressions_email_hash_length"),
        ),
        sa.CheckConstraint(
            "reason IN ('bounce', 'complaint', 'manual')",
            name=op.f("ck_email_suppressions_reason_enum"),
        ),
    )
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("target_type", sa.String(64), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=True),
        sa.Column("diff_hash", sa.LargeBinary(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_audit_logs"),
        sa.ForeignKeyConstraint(
            ["actor_id"],
            ["users.id"],
            name="fk_audit_logs_actor_id_users",
            ondelete="SET NULL",
        ),
        sa.CheckConstraint(
            "diff_hash IS NULL OR octet_length(diff_hash) = 32",
            name=op.f("ck_audit_logs_diff_hash_length"),
        ),
    )
    op.create_index(
        "ix_audit_logs_target_type_target_id",
        "audit_logs",
        ["target_type", "target_id"],
    )
    op.create_index("ix_audit_logs_actor_id", "audit_logs", ["actor_id"])
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])
    op.create_table(
        "exports",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("city_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("path", sa.String(512), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_exports"),
        sa.ForeignKeyConstraint(
            ["city_id"],
            ["cities.id"],
            name="fk_exports_city_id_cities",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("city_id", "version", name="uq_exports_city_id_version"),
        sa.CheckConstraint("version >= 1", name=op.f("ck_exports_version_positive")),
    )
    op.create_foreign_key(
        "fk_lines_current_version_id_line_versions",
        "lines",
        "line_versions",
        ["current_version_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.execute(
        """
        CREATE FUNCTION line_versions_reject_mutation() RETURNS trigger
        LANGUAGE plpgsql AS $$
        DECLARE
            restored line_versions%ROWTYPE;
        BEGIN
            IF TG_OP = 'UPDATE' THEN
                IF OLD.published_by IS NOT NULL AND NEW.published_by IS NULL THEN
                    restored := NEW;
                    restored.published_by := OLD.published_by;
                    IF restored IS NOT DISTINCT FROM OLD THEN
                        RETURN NEW;
                    END IF;
                END IF;
            END IF;
            RAISE EXCEPTION 'line_versions is immutable' USING ERRCODE = 'restrict_violation';
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_line_versions_immutable
        BEFORE UPDATE OR DELETE ON line_versions
        FOR EACH ROW EXECUTE FUNCTION line_versions_reject_mutation()
        """
    )
    op.execute(
        """
        CREATE FUNCTION line_stops_reject_mutation() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'line_stops is immutable' USING ERRCODE = 'restrict_violation';
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_line_stops_immutable
        BEFORE UPDATE OR DELETE ON line_stops
        FOR EACH ROW EXECUTE FUNCTION line_stops_reject_mutation()
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER trg_line_stops_immutable ON line_stops")
    op.execute("DROP TRIGGER trg_line_versions_immutable ON line_versions")
    op.execute("DROP FUNCTION line_stops_reject_mutation()")
    op.execute("DROP FUNCTION line_versions_reject_mutation()")
    op.drop_constraint("fk_lines_current_version_id_line_versions", "lines", type_="foreignkey")
    op.drop_table("exports")
    op.drop_table("audit_logs")
    op.drop_table("email_suppressions")
    op.drop_table("webhook_events")
    op.drop_table("pack_downloads")
    op.drop_table("subscriptions")
    op.drop_table("traces")
    op.drop_table("deletion_requests")
    op.drop_table("favorites")
    op.drop_table("magic_links")
    op.drop_table("refresh_tokens")
    op.drop_table("sessions")
    op.drop_table("line_stops")
    op.drop_table("line_versions")
    op.drop_table("edits")
    op.drop_table("photos")
    op.drop_table("stops")
    op.drop_table("lines")
    op.drop_table("users")
    op.drop_table("cities")
