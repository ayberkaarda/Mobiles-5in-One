"""Bounded label-setting search; all costs are nonnegative."""

import heapq
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from itertools import count
from typing import Literal

from app.planner.graph import Network


class PlannerTimeout(Exception):  # noqa: N818
    """The cooperative search budget expired."""


@dataclass(frozen=True, slots=True)
class WalkLeg:
    from_stop: str | None
    to_stop: str | None
    metres: float
    kind: Literal["walk"] = "walk"


@dataclass(frozen=True, slots=True)
class RideLeg:
    line_id: str
    line_slug: str
    line_code: str
    board_stop: str
    alight_stop: str
    stop_count: int
    kind: Literal["ride"] = "ride"


type Leg = WalkLeg | RideLeg


@dataclass(frozen=True, slots=True)
class Itinerary:
    legs: tuple[Leg, ...]
    transfers: int
    walk_m: float
    ride_stops: int
    estimated_fare_minor: int | None


@dataclass(frozen=True, slots=True)
class PlanResult:
    itineraries: tuple[Itinerary, ...]


def _rank(itinerary: Itinerary) -> tuple[int, float]:
    return itinerary.transfers, itinerary.ride_stops + itinerary.walk_m / 100


@dataclass(frozen=True, slots=True)
class _Label:
    stop: str
    sequence: tuple[str, ...]
    active: str | None
    board: str | None
    legs: tuple[Leg, ...]
    walk_m: float
    ride_stops: int

    @property
    def key(self) -> tuple[str, tuple[str, ...], str | None, str | None]:
        return self.stop, self.sequence, self.active, self.board

    @property
    def cost(self) -> float:
        return self.ride_stops + self.walk_m / 100


def _walk(legs: tuple[Leg, ...], first: str | None, last: str | None, m: float) -> tuple[Leg, ...]:
    if legs and isinstance(legs[-1], WalkLeg):
        previous = legs[-1]
        return (*legs[:-1], replace(previous, to_stop=last, metres=previous.metres + m))
    return (*legs, WalkLeg(first, last, m))


def plan(
    network: Network,
    origins: Sequence[tuple[str, float]],
    destinations: Sequence[tuple[str, float]],
    max_transfers: int,
    max_itineraries: int = 3,
    *,
    deadline: float | None,
    now: Callable[[], float],
) -> PlanResult:
    if max_transfers not in (0, 1, 2):
        raise ValueError("Invalid transfer limit")
    limit = min(3, max_itineraries)
    if limit <= 0:
        return PlanResult(())
    serial = count()
    queue: list[tuple[int, float, int, _Label]] = []
    best: dict[tuple[str, tuple[str, ...], str | None, str | None], float] = {}
    results: dict[tuple[str, ...], Itinerary] = {}
    egress = dict(destinations)
    cutoff: tuple[int, float] | None = None

    def check_time() -> None:
        if deadline is not None and now() >= deadline:
            raise PlannerTimeout

    def push(label: _Label) -> None:
        if label.cost >= best.get(label.key, float("inf")):
            return
        best[label.key] = label.cost
        heapq.heappush(queue, (max(0, len(label.sequence) - 1), label.cost, next(serial), label))

    check_time()
    for stop, metres in origins:
        if stop in network.stops:
            push(_Label(stop, (), None, None, (WalkLeg(None, stop, metres),), metres, 0))
    expansions = 0
    while queue:
        expansions += 1
        if expansions % 32 == 0:
            check_time()
        transfers, cost, _, label = heapq.heappop(queue)
        # Remaining labels cannot improve the third distinct completed sequence.
        if cutoff is not None and (transfers, cost) >= cutoff:
            break
        if label.cost != best[label.key]:
            continue
        if label.stop in egress:
            walk_m = label.walk_m + egress[label.stop]
            fares = [network.lines[line].fare_minor for line in label.sequence]
            candidate = Itinerary(
                _walk(label.legs, label.stop, None, egress[label.stop]),
                max(0, len(label.sequence) - 1),
                walk_m,
                label.ride_stops,
                None
                if any(fare is None for fare in fares)
                else sum(fare for fare in fares if fare is not None),
            )
            previous = results.get(label.sequence)
            if previous is None or candidate.ride_stops + candidate.walk_m / 100 < (
                previous.ride_stops + previous.walk_m / 100
            ):
                results[label.sequence] = candidate
                if len(results) >= limit:
                    cutoff = sorted(_rank(item) for item in results.values())[limit - 1]
        for edge in network.adjacent[label.stop]:
            expansions += 1
            if expansions % 32 == 0:
                check_time()
            if edge.line_id is None:
                push(
                    _Label(
                        edge.target,
                        label.sequence,
                        None,
                        None,
                        _walk(label.legs, label.stop, edge.target, edge.walk_m),
                        label.walk_m + edge.walk_m,
                        label.ride_stops,
                    )
                )
                continue
            continuing = edge.line_id == label.active
            sequence = label.sequence if continuing else (*label.sequence, edge.line_id)
            if len(sequence) > max_transfers + 1:
                continue
            board = label.board if continuing else label.stop
            if edge.target == board:
                continue
            line = network.lines[edge.line_id]
            legs = label.legs
            if continuing and legs and isinstance(legs[-1], RideLeg):
                ride = replace(
                    legs[-1], alight_stop=edge.target, stop_count=legs[-1].stop_count + 1
                )
                legs = (*legs[:-1], ride)
            else:
                legs = (*legs, RideLeg(line.id, line.slug, line.code, label.stop, edge.target, 1))
            push(
                _Label(
                    edge.target,
                    sequence,
                    edge.line_id,
                    board,
                    legs,
                    label.walk_m,
                    label.ride_stops + 1,
                )
            )
    check_time()
    ranked = sorted(results.values(), key=_rank)
    return PlanResult(tuple(ranked[:limit]))
