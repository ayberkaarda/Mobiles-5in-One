"""Hold a pending registration on its magic link (purpose and password hash)."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "magic_links",
        sa.Column("purpose", sa.String(16), nullable=False, server_default=sa.text("'login'")),
    )
    op.add_column("magic_links", sa.Column("password_hash", sa.String(255), nullable=True))
    op.create_check_constraint(
        op.f("ck_magic_links_purpose_enum"),
        "magic_links",
        "purpose IN ('login', 'register')",
    )
    op.create_check_constraint(
        op.f("ck_magic_links_password_hash_format"),
        "magic_links",
        "password_hash IS NULL OR password_hash LIKE '$argon2id$%'",
    )
    op.create_check_constraint(
        op.f("ck_magic_links_password_only_for_register"),
        "magic_links",
        "purpose = 'register' OR password_hash IS NULL",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_magic_links_password_only_for_register"), "magic_links")
    op.drop_constraint(op.f("ck_magic_links_password_hash_format"), "magic_links")
    op.drop_constraint(op.f("ck_magic_links_purpose_enum"), "magic_links")
    op.drop_column("magic_links", "password_hash")
    op.drop_column("magic_links", "purpose")
