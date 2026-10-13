from fastapi import APIRouter, Response

from app.auth.router import AuthRoute
from app.auth.schemas import EmptyIn, StepUpOut, TotpCodeIn, TotpEnrolOut, TotpStatusOut
from app.auth.service import REAUTH_WINDOW, locked_user, session_started_at
from app.auth.step_up import record_step_up, revoke_user_step_ups
from app.auth.totp import (
    encrypt_secret,
    encryption_key,
    matching_counter,
    new_secret,
    provisioning_uri,
    stored_secret,
)
from app.core.deps import (
    ClientIpDep,
    DbDep,
    Principal,
    PrincipalDep,
    Services,
    ServicesDep,
    enforce_ip_rate_limit,
    enforce_rate_limit,
)
from app.core.errors import (
    REAUTH_REQUIRED,
    STEP_UP_REQUIRED,
    TOTP_ALREADY_ENABLED,
    TOTP_ENROLMENT_REQUIRED,
    TOTP_INVALID_CODE,
    TOTP_NOT_PENDING,
    ProblemError,
)
from app.security.audit import audit
from app.security.deps import step_up_context
from app.security.policy import STEP_UP_TTL, totp_step_up

router = APIRouter(tags=["authentication"], route_class=AuthRoute)


async def limit_verification(services: Services, principal: Principal, client_ip: str) -> None:
    await enforce_rate_limit(
        services.rate_limiter, "auth.step_up", "user:" + str(principal.user_id)
    )
    await enforce_ip_rate_limit(services.rate_limiter, "auth.step_up", client_ip)


@router.get("/me/totp")
async def status(response: Response, principal: PrincipalDep, db: DbDep) -> TotpStatusOut:
    user = await locked_user(db, principal.user_id)
    response.headers["Cache-Control"] = "no-store"
    return TotpStatusOut.from_user(user)


@router.post("/me/totp/enrol", status_code=201)
async def enrol(
    body: EmptyIn,
    response: Response,
    principal: PrincipalDep,
    db: DbDep,
    services: ServicesDep,
) -> TotpEnrolOut:
    now = services.clock.now()
    user = await locked_user(db, principal.user_id)
    started_at = await session_started_at(db, principal)
    if started_at is None or started_at < now - REAUTH_WINDOW:
        raise ProblemError(REAUTH_REQUIRED, 403)
    if user.totp_enabled_at is not None:
        raise ProblemError(TOTP_ALREADY_ENABLED, 409)
    secret = new_secret()
    user.totp_secret_enc = encrypt_secret(encryption_key(services.settings), user.id, secret)
    user.totp_last_counter = None
    user.totp_enabled_at = None
    user.updated_at = now
    audit(db, principal, "totp.enrol", "user", user.id, {"totp": "pending"}, now)
    await db.commit()
    response.headers["Cache-Control"] = "no-store"
    return TotpEnrolOut(secret=secret, otpauth_uri=provisioning_uri(secret, user.email))


@router.post("/me/totp/confirm")
async def confirm(
    body: TotpCodeIn,
    response: Response,
    principal: PrincipalDep,
    db: DbDep,
    services: ServicesDep,
    client_ip: ClientIpDep,
) -> TotpStatusOut:
    await limit_verification(services, principal, client_ip)
    now = services.clock.now()
    user = await locked_user(db, principal.user_id)
    if user.totp_secret_enc is None or user.totp_enabled_at is not None:
        raise ProblemError(TOTP_NOT_PENDING, 409)
    secret = stored_secret(services.settings, user.id, user.totp_secret_enc)
    counter = matching_counter(secret, body.code, now, user.totp_last_counter)
    if counter is None:
        audit(db, principal, "totp.confirm_failed", "user", user.id, {"result": "invalid"}, now)
        await db.commit()
        raise ProblemError(TOTP_INVALID_CODE, 403)
    user.totp_enabled_at = now
    user.totp_last_counter = counter
    user.updated_at = now
    audit(db, principal, "totp.confirm", "user", user.id, {"totp": "enabled"}, now)
    await db.commit()
    response.headers["Cache-Control"] = "no-store"
    return TotpStatusOut.from_user(user)


@router.post("/auth/step-up")
async def step_up(
    body: TotpCodeIn,
    response: Response,
    principal: PrincipalDep,
    db: DbDep,
    services: ServicesDep,
    client_ip: ClientIpDep,
) -> StepUpOut:
    await limit_verification(services, principal, client_ip)
    now = services.clock.now()
    user = await locked_user(db, principal.user_id)
    if user.totp_enabled_at is None or user.totp_secret_enc is None:
        raise ProblemError(TOTP_ENROLMENT_REQUIRED, 403)
    secret = stored_secret(services.settings, user.id, user.totp_secret_enc)
    counter = matching_counter(secret, body.code, now, user.totp_last_counter)
    if counter is None:
        audit(
            db,
            principal,
            "auth.step_up_failed",
            "session",
            principal.session_id,
            {"mode": principal.auth_mode},
            now,
        )
        await db.commit()
        raise ProblemError(TOTP_INVALID_CODE, 403)
    user.totp_last_counter = counter
    user.updated_at = now
    await record_step_up(db, principal, now)
    audit(
        db,
        principal,
        "auth.step_up",
        "session",
        principal.session_id,
        {"mode": principal.auth_mode},
        now,
    )
    await db.commit()
    response.headers["Cache-Control"] = "no-store"
    return StepUpOut(verified_at=now, expires_at=now + STEP_UP_TTL)


@router.delete("/me/totp", status_code=204, response_model=None)
async def disable(
    response: Response, principal: PrincipalDep, db: DbDep, services: ServicesDep
) -> None:
    user = await locked_user(db, principal.user_id)
    context = await step_up_context(db, principal, services)
    if not context.totp_enrolled:
        raise ProblemError(TOTP_ENROLMENT_REQUIRED, 403)
    if not totp_step_up(context):
        raise ProblemError(STEP_UP_REQUIRED, 403)
    now = services.clock.now()
    user.totp_secret_enc = None
    user.totp_enabled_at = None
    user.totp_last_counter = None
    user.updated_at = now
    await revoke_user_step_ups(db, user.id)
    audit(db, principal, "totp.disable", "user", user.id, {"totp": "disabled"}, now)
    await db.commit()
    response.headers["Cache-Control"] = "no-store"
