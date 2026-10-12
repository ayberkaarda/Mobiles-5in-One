import hashlib
import json
import uuid
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal
from app.core.ids import uuid7
from app.models import AuditLog


def audit(
    db: AsyncSession,
    actor_id: Principal | uuid.UUID | None,
    action: str,
    target_type: str,
    target_id: uuid.UUID | None,
    diff: object,
    now: datetime,
) -> None:
    canonical = json.dumps(diff, sort_keys=True, separators=(",", ":")).encode()
    db.add(
        AuditLog(
            id=uuid7(),
            actor_id=actor_id.user_id if isinstance(actor_id, Principal) else actor_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            diff_hash=hashlib.sha256(canonical).digest(),
            created_at=now,
            updated_at=now,
        )
    )
