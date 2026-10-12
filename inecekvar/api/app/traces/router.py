import uuid
from datetime import datetime, timedelta
from typing import Annotated, Self

from fastapi import APIRouter, Depends, Response
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator
from shapely.geometry import LineString

from app.auth.service import locked_user
from app.cities.router import get_city
from app.core.deps import (
    ClockDep,
    DbDep,
    PrincipalDep,
    RateLimiterDep,
    SettingsDep,
    enforce_rate_limit,
)
from app.core.errors import AUTH_FORBIDDEN, ProblemError
from app.core.ids import uuid7
from app.geo import bbox_contains, geodesic_length, validate_coordinate
from app.models import Trace
from app.security.deps import require_permission
from app.security.policy import Action, ResourceContext, authorize

router = APIRouter()
type TraceNumber = Annotated[float, Field(strict=True, allow_inf_nan=False)]
type TracePoint = tuple[TraceNumber, TraceNumber] | tuple[TraceNumber, TraceNumber, TraceNumber]


class TraceInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    city: Annotated[str, Field(min_length=1, max_length=80)]
    started_at: AwareDatetime
    ended_at: AwareDatetime
    points: Annotated[list[TracePoint], Field(min_length=2, max_length=5000)]

    @model_validator(mode="after")
    def valid(self) -> Self:
        if self.started_at > self.ended_at or self.ended_at - self.started_at > timedelta(hours=12):
            raise ValueError("Iz suresi gecersiz.")
        coordinates = [validate_coordinate((point[0], point[1])) for point in self.points]
        if len(set(coordinates)) < 2 or not LineString(coordinates).is_valid:
            raise ValueError("Iz geometrisi gecersiz.")
        if geodesic_length(coordinates) > 150000:
            raise ValueError("Iz cok uzun.")
        return self


class TraceCreated(BaseModel):
    id: uuid.UUID
    point_count: int
    delete_after: datetime


class TraceOut(TraceCreated):
    points: list[object]
    started_at: datetime
    ended_at: datetime


@router.post(
    "/traces", status_code=201, dependencies=[Depends(require_permission(Action.UPLOAD_TRACE))]
)
async def upload_trace(
    body: TraceInput,
    db: DbDep,
    principal: PrincipalDep,
    clock: ClockDep,
    limiter: RateLimiterDep,
    settings: SettingsDep,
) -> TraceCreated:
    await enforce_rate_limit(limiter, "traces", "user:" + str(principal.user_id))
    await locked_user(db, principal.user_id)
    now = clock.now()
    if body.ended_at > now + timedelta(minutes=5):
        raise ProblemError("trace.future_end", 422)
    city = await get_city(db, body.city)
    if not bbox_contains(city.bbox, [(point[0], point[1]) for point in body.points]):
        raise ProblemError("trace.outside_bbox", 422)
    expiry = now + timedelta(days=settings.trace_retention_days)
    trace = Trace(
        id=uuid7(),
        author_id=principal.user_id,
        city_id=city.id,
        points=[list(point) for point in body.points],
        started_at=body.started_at,
        ended_at=body.ended_at,
        delete_after=expiry,
        created_at=now,
        updated_at=now,
    )
    db.add(trace)
    await db.commit()
    return TraceCreated(id=trace.id, point_count=len(body.points), delete_after=expiry)


@router.get("/traces/{identity}")
async def read_trace(
    identity: uuid.UUID,
    db: DbDep,
    principal: PrincipalDep,
    clock: ClockDep,
) -> TraceOut:
    trace = await db.get(Trace, identity)
    if trace is None:
        raise ProblemError("trace.not_found", 404)
    authorize(
        principal,
        Action.VIEW_TRACE,
        ResourceContext(actor_id=None, trace_owner_id=trace.author_id, now=clock.now()),
    )
    if trace.delete_after is None:
        raise ProblemError("trace.invalid_retention", 503)
    return TraceOut(
        id=trace.id,
        point_count=len(trace.points),
        delete_after=trace.delete_after,
        points=trace.points,
        started_at=trace.started_at,
        ended_at=trace.ended_at,
    )


@router.delete("/traces/{identity}", status_code=204)
async def delete_trace(identity: uuid.UUID, db: DbDep, principal: PrincipalDep) -> Response:
    trace = await db.get(Trace, identity)
    if trace is None:
        raise ProblemError("trace.not_found", 404)
    if trace.author_id != principal.user_id:
        raise ProblemError(AUTH_FORBIDDEN, 403)
    await db.delete(trace)
    await db.commit()
    return Response(status_code=204)
