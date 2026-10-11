from collections.abc import Callable, Coroutine
from typing import Any

import structlog
from fastapi import APIRouter, Depends, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from sqlalchemy import update

from app.auth.passwords import check_password_policy
from app.auth.schemas import (
    BearerOut,
    CookieOut,
    CsrfOut,
    DeleteMeIn,
    EmptyIn,
    LoginIn,
    MagicLinkIn,
    MeOut,
    PatchMeIn,
    RefreshIn,
    RefreshOut,
    RegisterIn,
    StatusOut,
    VerifyIn,
)
from app.auth.service import (
    accept_licence,
    locked_user,
    password_login,
    request_deletion,
    rotate_refresh,
    send_link,
    verify_link,
)
from app.auth.sessions import (
    clear_session_cookie,
    issue_session,
    revoke_family,
    revoke_user,
    roll_session,
)
from app.core.deps import (
    BreachCheckerDep,
    ClockDep,
    DbDep,
    MailSenderDep,
    PrincipalDep,
    RateLimiterDep,
    ServicesDep,
    SettingsDep,
    check_cookie_origin,
    csrf_token_for,
    enforce_rate_limit,
    normalize_email,
    rate_limit,
)
from app.core.errors import AUTH_REQUIRED, VALIDATION_FAILED, ProblemError
from app.models.accounts import UserSession
from app.models.enums import RefreshRevokeReason


class AuthRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def handle(request: Request) -> Response:
            try:
                return await handler(request)
            except RequestValidationError:
                raise ProblemError(VALIDATION_FAILED, 422) from None

        return handle


router = APIRouter(tags=["authentication"], route_class=AuthRoute)


@router.post("/auth/register", status_code=202, dependencies=[Depends(rate_limit("auth.register"))])
async def register(
    body: RegisterIn,
    db: DbDep,
    settings: SettingsDep,
    limiter: RateLimiterDep,
    clock: ClockDep,
    mail: MailSenderDep,
    breach: BreachCheckerDep,
) -> StatusOut:
    email = normalize_email(body.email)
    await enforce_rate_limit(limiter, "auth.register", "email:" + email)
    await check_password_policy(body.password, email, breach, settings)
    await send_link(db, settings, mail, email, clock.now(), body.password)
    return StatusOut(status="check_email")


@router.post(
    "/auth/magic-link", status_code=202, dependencies=[Depends(rate_limit("auth.magic_link"))]
)
async def magic_link(
    body: MagicLinkIn,
    db: DbDep,
    settings: SettingsDep,
    limiter: RateLimiterDep,
    clock: ClockDep,
    mail: MailSenderDep,
) -> StatusOut:
    email = normalize_email(body.email)
    await enforce_rate_limit(limiter, "auth.magic_link", "email:" + email)
    await send_link(db, settings, mail, email, clock.now())
    return StatusOut(status="check_email")


@router.post("/auth/magic-link/verify")
async def magic_link_verify(
    body: VerifyIn,
    request: Request,
    response: Response,
    db: DbDep,
    settings: SettingsDep,
    clock: ClockDep,
) -> CookieOut | BearerOut:
    if body.mode == "cookie":
        check_cookie_origin(request, settings)
    now = clock.now()
    user = await verify_link(db, body.token, now)
    output = await issue_session(db, settings, request, response, user, body.mode, now)
    structlog.get_logger().info("auth.magic_link.verified", user_id=str(user.id))
    return output


@router.post("/auth/login", dependencies=[Depends(rate_limit("auth.login"))])
async def login(
    body: LoginIn,
    request: Request,
    response: Response,
    db: DbDep,
    settings: SettingsDep,
    limiter: RateLimiterDep,
    clock: ClockDep,
) -> CookieOut | BearerOut:
    email = normalize_email(body.email)
    await enforce_rate_limit(limiter, "auth.login", "email:" + email)
    now = clock.now()
    user = await password_login(db, settings, email, body.password, now)
    output = await issue_session(db, settings, request, response, user, body.mode, now)
    structlog.get_logger().info("auth.login.succeeded", user_id=str(user.id))
    return output


@router.post("/auth/refresh", dependencies=[Depends(rate_limit("auth.refresh"))])
async def refresh(
    body: RefreshIn,
    response: Response,
    db: DbDep,
    settings: SettingsDep,
    limiter: RateLimiterDep,
    clock: ClockDep,
) -> RefreshOut:
    now = clock.now()
    output = await rotate_refresh(db, settings, limiter, body.refresh_token, now)
    response.headers["Cache-Control"] = "no-store"
    return output


@router.post("/auth/csrf")
async def csrf(request: Request, response: Response, db: DbDep, services: ServicesDep) -> CsrfOut:
    principal = await services.authenticator.authenticate(request, db)
    if principal is None or principal.auth_mode != "cookie":
        raise ProblemError(AUTH_REQUIRED, 401)
    check_cookie_origin(request, services.settings)
    await roll_session(
        db, services.settings, request, response, principal.session_id, services.clock.now()
    )
    response.headers["Cache-Control"] = "no-store"
    return CsrfOut(csrf_token=csrf_token_for(services.settings, principal.session_id))


@router.post("/auth/logout", status_code=204, response_model=None)
async def logout(
    response: Response,
    principal: PrincipalDep,
    db: DbDep,
    settings: SettingsDep,
    clock: ClockDep,
) -> None:
    await locked_user(db, principal.user_id)
    now = clock.now()
    if principal.auth_mode == "cookie":
        await db.execute(
            update(UserSession)
            .where(UserSession.id == principal.session_id)
            .values(revoked_at=now, updated_at=now)
        )
        clear_session_cookie(response, settings)
    else:
        await revoke_family(db, principal.session_id, now, RefreshRevokeReason.LOGOUT)
    await db.commit()
    structlog.get_logger().info("auth.logout.succeeded", user_id=str(principal.user_id))


@router.post("/auth/logout-all", status_code=204, response_model=None)
async def logout_all(
    response: Response,
    principal: PrincipalDep,
    db: DbDep,
    settings: SettingsDep,
    clock: ClockDep,
) -> None:
    await locked_user(db, principal.user_id)
    await revoke_user(db, principal.user_id, clock.now(), RefreshRevokeReason.LOGOUT_ALL)
    await db.commit()
    if principal.auth_mode == "cookie":
        clear_session_cookie(response, settings)
    structlog.get_logger().info("auth.logout_all.succeeded", user_id=str(principal.user_id))


@router.get("/me")
async def me(
    request: Request,
    response: Response,
    principal: PrincipalDep,
    db: DbDep,
    settings: SettingsDep,
    clock: ClockDep,
) -> MeOut:
    user = await locked_user(db, principal.user_id)
    if principal.auth_mode == "cookie":
        await roll_session(db, settings, request, response, principal.session_id, clock.now())
    response.headers["Cache-Control"] = "no-store"
    return MeOut.from_user(user)


@router.patch("/me")
async def patch_me(body: PatchMeIn, principal: PrincipalDep, db: DbDep, clock: ClockDep) -> MeOut:
    user = await locked_user(db, principal.user_id)
    user.display_name = body.display_name
    user.updated_at = clock.now()
    await db.commit()
    return MeOut.from_user(user)


@router.post("/me/licence-accept")
async def licence_accept(
    body: EmptyIn, principal: PrincipalDep, db: DbDep, clock: ClockDep
) -> MeOut:
    user = await locked_user(db, principal.user_id)
    await accept_licence(db, user, clock.now())
    await db.commit()
    return MeOut.from_user(user)


@router.delete("/me", status_code=202)
async def delete_me(
    body: DeleteMeIn,
    response: Response,
    principal: PrincipalDep,
    db: DbDep,
    settings: SettingsDep,
    clock: ClockDep,
) -> StatusOut:
    user = await locked_user(db, principal.user_id)
    await request_deletion(db, settings, principal, user, body.password, clock.now())
    if principal.auth_mode == "cookie":
        clear_session_cookie(response, settings)
    return StatusOut(status="deletion_scheduled")
