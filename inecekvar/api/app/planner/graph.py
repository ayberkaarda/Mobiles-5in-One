"""Bidirectional dolmus rides and symmetric nearby-stop walking links."""

import math
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from itertools import pairwise, product

import networkx as nx

EARTH_M = 6371008.8


@dataclass(frozen=True, slots=True)
class StopNode:
    id: str
    lng: float
    lat: float


@dataclass(frozen=True, slots=True)
class RouteLine:
    id: str
    slug: str
    code: str
    name: str
    fare_minor: int | None
    stop_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class Edge:
    target: str
    line_id: str | None
    walk_m: float = 0.0


@dataclass(frozen=True, slots=True)
class Network:
    graph: "nx.MultiDiGraph[str]"
    stops: dict[str, StopNode]
    lines: dict[str, RouteLine]
    adjacent: dict[str, tuple[Edge, ...]]


WALK_NEIGHBOURS = 12


def haversine(first: StopNode, second: StopNode) -> float:
    lat1, lat2 = math.radians(first.lat), math.radians(second.lat)
    term = math.sin((lat2 - lat1) / 2) ** 2
    term += (
        math.cos(lat1) * math.cos(lat2) * math.sin(math.radians(second.lng - first.lng) / 2) ** 2
    )
    return 2 * EARTH_M * math.asin(math.sqrt(min(1.0, term)))


def _cell(stop: StopNode, size: float) -> tuple[int, int, int]:
    lat, lng = math.radians(stop.lat), math.radians(stop.lng)
    return (
        math.floor(EARTH_M * math.cos(lat) * math.cos(lng) / size),
        math.floor(EARTH_M * math.cos(lat) * math.sin(lng) / size),
        math.floor(EARTH_M * math.sin(lat) / size),
    )


def build_network(
    stops: Iterable[StopNode], lines: Iterable[RouteLine], walk_limit_m: float = 300.0
) -> Network:
    if not math.isfinite(walk_limit_m) or walk_limit_m < 0:
        raise ValueError("Invalid walking limit")
    nodes = {stop.id: stop for stop in stops}
    routes = {line.id: line for line in lines}
    graph: nx.MultiDiGraph[str] = nx.MultiDiGraph()
    graph.add_nodes_from(nodes)
    adjacent: dict[str, list[Edge]] = {identity: [] for identity in nodes}

    def connect(first: str, second: str, line_id: str | None, distance: float = 0.0) -> None:
        graph.add_edge(first, second, line_id=line_id, walk_m=distance)
        adjacent[first].append(Edge(second, line_id, distance))
        graph.add_edge(second, first, line_id=line_id, walk_m=distance)
        adjacent[second].append(Edge(first, line_id, distance))

    for line in routes.values():
        for first, second in pairwise(line.stop_ids):
            if first != second and first in nodes and second in nodes:
                connect(first, second, line.id)
    # Earth-centred cubic buckets avoid polar and longitude-wrap projection errors.
    # Chord distance never exceeds arc distance, so all nearby pairs are in adjacent cells.
    buckets: dict[tuple[int, int, int], list[StopNode]] = defaultdict(list)
    size = max(walk_limit_m, 0.001)
    # Each stop keeps walking links to at most WALK_NEIGHBOURS nearest stops (a pair is linked
    # when it is among the nearest of either end), so a dense cluster cannot make the graph
    # quadratic in size.
    nearest: dict[str, list[tuple[float, str]]] = defaultdict(list)
    for stop in nodes.values():
        cell = _cell(stop, size)
        for dx, dy, dz in product((-1, 0, 1), repeat=3):
            for other in buckets.get((cell[0] + dx, cell[1] + dy, cell[2] + dz), ()):
                distance = haversine(stop, other)
                if distance <= walk_limit_m:
                    nearest[stop.id].append((distance, other.id))
                    nearest[other.id].append((distance, stop.id))
        buckets[cell].append(stop)
    linked: dict[tuple[str, str], float] = {}
    for identity, found in nearest.items():
        for distance, neighbour in sorted(found)[:WALK_NEIGHBOURS]:
            linked[min(identity, neighbour), max(identity, neighbour)] = distance
    for (first, second), distance in sorted(linked.items()):
        connect(first, second, None, distance)
    return Network(graph, nodes, routes, {key: tuple(value) for key, value in adjacent.items()})
