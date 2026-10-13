from datetime import datetime

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.accounts import DeletionRequest, User
from app.models.ops import AuditLog


async def cancel_scheduled_deletion(db: AsyncSession, user: User, now: datetime) -> bool:
    if user.deactivated_at is None:
        return False
    request = await db.scalar(
        select(DeletionRequest)
        .where(
            DeletionRequest.user_id == user.id,
            DeletionRequest.state == "scheduled",
            DeletionRequest.scheduled_for > now,
        )
        .with_for_update()
    )
    if request is None:
        return False
    request.state = "cancelled"
    request.cancelled_at = now
    request.updated_at = now
    user.deactivated_at = None
    user.updated_at = now
    db.add(
        AuditLog(
            actor_id=user.id,
            action="account.delete_cancelled",
            target_type="user",
            target_id=user.id,
            created_at=now,
            updated_at=now,
        )
    )
    # Structured, no PII: the restore runbook builds its cancellations list from these lines
    # (ops/backup/replay-deletions.sh, phase 6 review F7).
    structlog.get_logger().info(
        "auth.account.delete_cancelled", user_id=str(user.id), cancelled_at=now.isoformat()
    )
    return True
