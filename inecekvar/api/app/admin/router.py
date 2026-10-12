import uuid
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query
from pydantic import AwareDatetime, BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.router import AuthRoute
from app.auth.step_up import revoke_user_step_ups
from app.core.deps import DbDep, ObjectStoreDep, Principal, ServicesDep, enforce_rate_limit
from app.core.errors import VALIDATION_FAILED, ProblemError
from app.lines.router import Limit, Offset
from app.models.accounts import User
from app.models.enums import UserRole
from app.models.ops import AuditLog, Export
from app.security.admins import ensure_admin_remains, lock_admins, revalidate_admin_actor
from app.security.audit import audit
from app.security.deps import require_step_up
from app.security.policy import Action
from app.workers.export import export_city

router = APIRouter(prefix="/admin", tags=["admin"], route_class=AuthRoute)
type ManageUsersDep = Annotated[Principal, Depends(require_step_up(Action.MANAGE_USERS))]
type ExportAdminDep = Annotated[Principal, Depends(require_step_up(Action.EXPORT_ADMIN))]
type AuditFilter = Annotated[str | None, Query(pattern=r"^[a-z_.]{1,64}$")]


class AdminUserOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    email: str
    display_name: str | None
    role: UserRole
    created_at: datetime
    email_verified_at: datetime | None
    totp_enabled: bool
    deactivated_at: datetime | None


class AdminUserPage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[AdminUserOut]
    total: int
    limit: int
    offset: int


class RoleChangeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: UserRole


class AdminExportOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    city: str
    version: int
    path: str
    published_at: datetime


class AuditLogOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    actor_id: uuid.UUID | None
    action: str
    target_type: str
    target_id: uuid.UUID | None
    diff_hash: str | None
    created_at: datetime


class AuditLogPage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[AuditLogOut]
    total: int
    limit: int
    offset: int


def user_response(user: User) -> AdminUserOut:
    return AdminUserOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        role=UserRole(user.role),
        created_at=user.created_at,
        email_verified_at=user.email_verified_at,
        totp_enabled=user.totp_enabled_at is not None,
        deactivated_at=user.deactivated_at,
    )


@router.get("/users")
async def list_users(
    principal: ManageUsersDep,
    db: DbDep,
    services: ServicesDep,
    limit: Limit = 50,
    offset: Offset = 0,
    role: UserRole | None = None,
) -> AdminUserPage:
    query = select(User)
    if role is not None:
        query = query.where(User.role == role.value)
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    rows = await db.scalars(query.order_by(User.created_at, User.id).limit(limit).offset(offset))
    items = [user_response(user) for user in rows]
    audit(
        db,
        principal,
        "admin.users_read",
        "user",
        None,
        {
            "filters": {
                "role": role.value if role is not None else None,
                "limit": limit,
                "offset": offset,
            },
            "result_count": len(items),
        },
        services.clock.now(),
    )
    await db.commit()
    return AdminUserPage(
        items=items,
        total=total or 0,
        limit=limit,
        offset=offset,
    )


@router.patch("/users/{identity}/role")
async def change_role(
    identity: uuid.UUID,
    body: RoleChangeIn,
    principal: ManageUsersDep,
    db: DbDep,
    services: ServicesDep,
) -> AdminUserOut:
    active_admins = await lock_admins(db)
    now = services.clock.now()
    await revalidate_admin_actor(db, principal, now)
    user = await db.scalar(
        select(User)
        .where(User.id == identity)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if user is None:
        raise ProblemError("user.not_found", 404)
    if user.deactivated_at is not None:
        raise ProblemError("user.deactivated", 409)
    old_role = UserRole(user.role)
    if old_role == body.role:
        return user_response(user)
    if old_role == UserRole.ADMIN and body.role != UserRole.ADMIN:
        ensure_admin_remains(active_admins, user.id)
    user.role = body.role.value
    user.updated_at = now
    privileged = {UserRole.MODERATOR, UserRole.ADMIN}
    if old_role == UserRole.ADMIN or (old_role in privileged and body.role not in privileged):
        await revoke_user_step_ups(db, user.id)
    audit(
        db,
        principal,
        "admin.user_role",
        "user",
        user.id,
        {"role": {"from": old_role.value, "to": body.role.value}},
        now,
    )
    await db.commit()
    return user_response(user)


@router.post("/exports/{city}", status_code=201)
async def create_export(
    city: Annotated[str, Path(max_length=120, pattern=r"^[a-z0-9-]+$")],
    principal: ExportAdminDep,
    db: DbDep,
    services: ServicesDep,
    store: ObjectStoreDep,
) -> AdminExportOut:
    await enforce_rate_limit(
        services.rate_limiter, "admin.export", "user:" + str(principal.user_id)
    )

    def before_commit(session: AsyncSession, exported: Export) -> None:
        audit(
            session,
            principal,
            "admin.export",
            "city",
            exported.city_id,
            {"version": exported.version},
            services.clock.now(),
        )

    exported = await export_city(
        services.session_factory,
        store,
        services.settings,
        services.clock,
        city,
        before_commit=before_commit,
    )
    return AdminExportOut(
        city=city,
        version=exported.version,
        path=exported.path,
        published_at=exported.published_at,
    )


@router.get("/audit-logs")
async def list_audit_logs(
    principal: ManageUsersDep,
    db: DbDep,
    services: ServicesDep,
    limit: Limit = 50,
    offset: Offset = 0,
    actor_id: uuid.UUID | None = None,
    action: AuditFilter = None,
    target_type: AuditFilter = None,
    target_id: uuid.UUID | None = None,
    since: AwareDatetime | None = None,
    until: AwareDatetime | None = None,
) -> AuditLogPage:
    until = until if until is not None else services.clock.now()
    since = since if since is not None else until - timedelta(days=30)
    span = until - since
    if span < timedelta(0) or span > timedelta(days=366):
        raise ProblemError(VALIDATION_FAILED, 422)
    query = select(AuditLog)
    if actor_id is not None:
        query = query.where(AuditLog.actor_id == actor_id)
    if action is not None:
        query = query.where(AuditLog.action == action)
    if target_type is not None:
        query = query.where(AuditLog.target_type == target_type)
    if target_id is not None:
        query = query.where(AuditLog.target_id == target_id)
    if since is not None:
        query = query.where(AuditLog.created_at >= since)
    if until is not None:
        query = query.where(AuditLog.created_at <= until)
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    rows = await db.scalars(
        query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(limit).offset(offset)
    )
    page = AuditLogPage(
        items=[
            AuditLogOut(
                id=row.id,
                actor_id=row.actor_id,
                action=row.action,
                target_type=row.target_type,
                target_id=row.target_id,
                diff_hash=row.diff_hash.hex() if row.diff_hash is not None else None,
                created_at=row.created_at,
            )
            for row in rows
        ],
        total=total or 0,
        limit=limit,
        offset=offset,
    )
    audit(
        db,
        principal,
        "admin.audit_read",
        "audit_log",
        None,
        {
            "filters": {
                "actor_id": str(actor_id) if actor_id is not None else None,
                "action": action,
                "target_type": target_type,
                "target_id": str(target_id) if target_id is not None else None,
                "since": since.isoformat(),
                "until": until.isoformat(),
                "limit": limit,
                "offset": offset,
            },
            "result_count": len(page.items),
        },
        services.clock.now(),
    )
    await db.commit()
    return page
