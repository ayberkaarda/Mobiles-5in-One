from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


class PointInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lat: Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]
    lng: Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)]


class PlanInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    city: Annotated[str, Field(min_length=1, max_length=80, pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")]
    origin: PointInput = Field(alias="from")
    destination: PointInput = Field(alias="to")
    max_transfers: Annotated[int, Field(strict=True, ge=0, le=2)] = 2


class StopOutput(BaseModel):
    slug: str
    name: str
    location: tuple[float, float]


class WalkOutput(BaseModel):
    kind: Literal["walk"] = "walk"
    metres: float
    from_stop: StopOutput | None
    to_stop: StopOutput | None


class RideOutput(BaseModel):
    kind: Literal["ride"] = "ride"
    line_id: str
    line_slug: str
    line_code: str
    line_name: str
    board_stop: StopOutput
    alight_stop: StopOutput
    stop_count: int


class ItineraryOutput(BaseModel):
    legs: list[WalkOutput | RideOutput]
    transfers: int
    walk_m: float
    ride_stops: int
    estimated_fare_minor: int | None


class PlanOutput(BaseModel):
    city: str
    degraded: bool
    itineraries: list[ItineraryOutput]
