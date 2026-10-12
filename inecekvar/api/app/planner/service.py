import asyncio
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from functools import partial

import anyio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Services
from app.geo import point_coordinates
from app.models import City, Line, LineVersion, Stop
from app.planner.graph import Network, RouteLine, StopNode, build_network, haversine
from app.planner.schemas import (
    ItineraryOutput,
    PlanInput,
    PlanOutput,
    RideOutput,
    StopOutput,
    WalkOutput,
)
from app.planner.search import PlannerTimeout, PlanResult, RideLeg, plan


@dataclass(frozen=True, slots=True)
class CityNetwork:
    network: Network
    stops: dict[str, StopOutput]


def cell(lng: float, lat: float) -> tuple[float, float]:
    return round(lng, 3) + 0.0, round(lat, 3) + 0.0


def cell_key(point: tuple[float, float]) -> str:
    return f"{point[0]:.3f},{point[1]:.3f}"


def candidates(network: Network, point: tuple[float, float]) -> list[tuple[str, float]]:
    centre = StopNode("", *point)
    distances = [(stop.id, haversine(centre, stop)) for stop in network.stops.values()]
    return sorted(
        (item for item in distances if item[1] <= 500), key=lambda item: (item[1], item[0])
    )[:8]


def response(city: str, stored: CityNetwork, result: PlanResult, degraded: bool) -> PlanOutput:
    itineraries: list[ItineraryOutput] = []
    for itinerary in result.itineraries:
        legs: list[WalkOutput | RideOutput] = []
        for leg in itinerary.legs:
            if isinstance(leg, RideLeg):
                legs.append(
                    RideOutput(
                        line_id=leg.line_id,
                        line_slug=leg.line_slug,
                        line_code=leg.line_code,
                        line_name=stored.network.lines[leg.line_id].name,
                        board_stop=stored.stops[leg.board_stop],
                        alight_stop=stored.stops[leg.alight_stop],
                        stop_count=leg.stop_count,
                    )
                )
            else:
                legs.append(
                    WalkOutput(
                        metres=leg.metres,
                        from_stop=stored.stops[leg.from_stop]
                        if leg.from_stop is not None
                        else None,
                        to_stop=stored.stops[leg.to_stop] if leg.to_stop is not None else None,
                    )
                )
        itineraries.append(
            ItineraryOutput(
                legs=legs,
                transfers=itinerary.transfers,
                walk_m=itinerary.walk_m,
                ride_stops=itinerary.ride_stops,
                estimated_fare_minor=itinerary.estimated_fare_minor,
            )
        )
    return PlanOutput(city=city, degraded=degraded, itineraries=itineraries)


class PlannerService:
    """Application-local LRU with serialized cold builds and immutable search inputs."""

    def __init__(self) -> None:
        self.networks: OrderedDict[tuple[uuid.UUID, int], CityNetwork] = OrderedDict()
        self.lock = asyncio.Lock()

    async def load_network(self, db: AsyncSession, city: City) -> CityNetwork:
        key = city.id, city.pack_version
        async with self.lock:
            existing = self.networks.get(key)
            if existing is not None:
                self.networks.move_to_end(key)
                return existing
            rows = list(
                await db.scalars(
                    select(Stop)
                    .where(
                        Stop.city_id == city.id,
                        Stop.status == "active",
                    )
                    .order_by(Stop.id)
                )
            )
            stops: dict[str, StopOutput] = {}
            nodes: list[StopNode] = []
            for stop in rows:
                lng, lat = point_coordinates(stop.location)
                identity = str(stop.id)
                nodes.append(StopNode(identity, lng, lat))
                stops[identity] = StopOutput(slug=stop.slug, name=stop.name, location=(lng, lat))
            published = await db.execute(
                select(Line, LineVersion)
                .join(LineVersion, Line.current_version_id == LineVersion.id)
                .where(Line.city_id == city.id, Line.status == "published")
                .order_by(Line.id)
            )
            lines = [
                RouteLine(
                    str(line.id),
                    line.slug,
                    line.code,
                    line.name,
                    version.fare_minor,
                    tuple(version.stop_ids),
                )
                for line, version in published.all()
            ]
            network = await anyio.to_thread.run_sync(partial(build_network, nodes, lines))
            stored = CityNetwork(network, stops)
            # Keep only the current pack for each city, then the eight newest cities.
            for old in list(self.networks):
                if old[0] == city.id:
                    del self.networks[old]
            self.networks[key] = stored
            if len(self.networks) > 8:
                self.networks.popitem(last=False)
            return stored

    async def search(
        self, services: Services, db: AsyncSession, city: City, body: PlanInput
    ) -> tuple[PlanOutput, bool]:
        origin = cell(body.origin.lng, body.origin.lat)
        destination = cell(body.destination.lng, body.destination.lat)
        key = (
            f"plan:v1:{city.slug}:{city.pack_version}:{cell_key(origin)}:"
            f"{cell_key(destination)}:{body.max_transfers}"
        )
        cached = await services.redis.get(key)
        if cached is not None:
            return PlanOutput.model_validate_json(cached), True
        stored = await self.load_network(db, city)
        origins = candidates(stored.network, origin)
        destinations = candidates(stored.network, destination)

        async def run(transfers: int, seconds: float) -> PlanResult:
            return await anyio.to_thread.run_sync(
                partial(
                    plan,
                    stored.network,
                    origins,
                    destinations,
                    transfers,
                    deadline=time.monotonic() + seconds,
                    now=time.monotonic,
                )
            )

        degraded = False
        try:
            result = await run(body.max_transfers, services.settings.planner_timeout_seconds)
        except PlannerTimeout:
            degraded = True
            try:
                result = await run(min(1, body.max_transfers), 1.0)
            except PlannerTimeout:
                result = PlanResult(())
        output = response(city.slug, stored, result, degraded)
        ttl = 60 if degraded else services.settings.planner_cache_ttl_seconds
        await services.redis.set(key, output.model_dump_json(), ex=ttl)
        return output, False
