"""Phase 2 domain: photo processing time and the trace to edit link index.

Line versions and line stops are already immutable at the database layer (0001 triggers);
rollback publishes a new version that copies an old one.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("photos", sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f("ix_traces_linked_edit_id"), "traces", ["linked_edit_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_traces_linked_edit_id"), table_name="traces")
    op.drop_column("photos", "processed_at")
