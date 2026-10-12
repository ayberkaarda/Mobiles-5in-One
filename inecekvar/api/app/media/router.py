import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from app.core.deps import (
    ClockDep,
    DbDep,
    ObjectStoreDep,
    PrincipalDep,
    RateLimiterDep,
    SettingsDep,
    enforce_rate_limit,
)
from app.core.errors import ProblemError
from app.core.ids import uuid7
from app.models import Photo
from app.security.deps import require_permission
from app.security.policy import Action

router = APIRouter()


class PresignInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["fare_table", "stop_sign"]
    content_type: Literal["image/jpeg", "image/webp"]
    byte_size: Annotated[int, Field(ge=1, le=4 * 1024 * 1024)]


class PresignOut(BaseModel):
    photo_id: uuid.UUID
    upload_url: str
    method: Literal["PUT"] = "PUT"
    headers: dict[str, str]
    expires_in: int


@router.post(
    "/media/presign",
    status_code=201,
    dependencies=[Depends(require_permission(Action.PROPOSE_EDIT))],
)
async def presign_photo(
    body: PresignInput,
    db: DbDep,
    principal: PrincipalDep,
    clock: ClockDep,
    limiter: RateLimiterDep,
    settings: SettingsDep,
    store: ObjectStoreDep,
) -> PresignOut:
    await enforce_rate_limit(limiter, "media.presign", "user:" + str(principal.user_id))
    if body.byte_size > settings.media_max_bytes:
        raise ProblemError("media.too_large", 422)
    identity = uuid7()
    key = "incoming/" + str(identity)
    url = await store.presign_put(
        settings.media_bucket,
        key,
        body.content_type,
        body.byte_size,
        settings.presign_ttl_seconds,
    )
    now = clock.now()
    db.add(
        Photo(
            id=identity,
            owner_id=principal.user_id,
            key=key,
            kind=body.kind,
            moderation_state="pending",
            content_type=body.content_type,
            byte_size=body.byte_size,
            created_at=now,
            updated_at=now,
        )
    )
    await db.commit()
    return PresignOut(
        photo_id=identity,
        upload_url=url,
        headers={"Content-Type": body.content_type, "Content-Length": str(body.byte_size)},
        expires_in=settings.presign_ttl_seconds,
    )
