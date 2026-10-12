import structlog
from fastapi import APIRouter, Depends, Request

from app.cities.router import get_city
from app.core.deps import DbDep, ServicesDep, rate_limit
from app.core.errors import ProblemError
from app.geo import bbox_contains
from app.planner.schemas import PlanInput, PlanOutput
from app.planner.service import PlannerService

router = APIRouter()
logger = structlog.get_logger(__name__)


@router.post("/plan", dependencies=[Depends(rate_limit("plan"))])
async def create_plan(
    body: PlanInput, request: Request, services: ServicesDep, db: DbDep
) -> PlanOutput:
    city = await get_city(db, body.city)
    if not bbox_contains(
        city.bbox,
        [
            (body.origin.lng, body.origin.lat),
            (body.destination.lng, body.destination.lat),
        ],
    ):
        raise ProblemError("plan.outside_city", 422)
    planner = getattr(request.app.state, "planner_service", None)
    if not isinstance(planner, PlannerService):
        planner = PlannerService()
        request.app.state.planner_service = planner
    output, hit = await planner.search(services, db, city, body)
    logger.info(
        "plan",
        city=city.slug,
        result_count=len(output.itineraries),
        degraded=output.degraded,
        cache_hit=hit,
    )
    return output
