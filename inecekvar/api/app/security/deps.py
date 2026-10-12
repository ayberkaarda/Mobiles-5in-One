"""Resource-free checks; resource checks require stored row context in the service."""

from collections.abc import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Clock, ClockDep, DbDep, OptionalPrincipalDep, Principal
from app.models.accounts import User
from app.security.policy import Action, ResourceContext, authorize


async def load_actor_context(
    db: AsyncSession, principal: Principal | None, clock: Clock
) -> ResourceContext:
    user = await db.get(User, principal.user_id) if principal is not None else None
    return ResourceContext(
        actor_id=None if principal is None else principal.user_id,
        licence_accepted_at=None if user is None else user.licence_accepted_at,
        now=clock.now(),
    )


def require_permission(
    action: Action,
) -> Callable[[Principal | None, AsyncSession, Clock], Awaitable[None]]:
    async def dependency(principal: OptionalPrincipalDep, db: DbDep, clock: ClockDep) -> None:
        if action in {Action.PROPOSE_EDIT, Action.UPLOAD_TRACE}:
            context = await load_actor_context(db, principal, clock)
        else:
            context = ResourceContext(
                actor_id=None if principal is None else principal.user_id, now=clock.now()
            )
        authorize(principal, action, context)

    return dependency
