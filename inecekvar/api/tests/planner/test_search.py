import math

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from app.planner.graph import EARTH_M, Network, RouteLine, StopNode, build_network
from app.planner.search import PlannerTimeout, PlanResult, RideLeg, WalkLeg, plan


def route(identity: str, stops: tuple[str, ...], fare: int | None = 100) -> RouteLine:
    return RouteLine(identity, identity, identity, identity, fare, stops)


def search(network: Network, first: str, last: str, k: int = 2) -> PlanResult:
    return plan(network, [(first, 0)], [(last, 0)], k, deadline=None, now=lambda: 0.0)


def test_direct_ride() -> None:
    network = build_network(
        [StopNode("a", 0, 0), StopNode("b", 0.02, 0)], [route("one", ("a", "b"))]
    )
    result = search(network, "a", "b", 0).itineraries[0]
    assert result.transfers == 0
    assert result.ride_stops == 1


def test_one_transfer_at_shared_stop() -> None:
    network = build_network(
        [StopNode(str(i), i * 0.02, 0) for i in range(3)],
        [route("one", ("0", "1")), route("two", ("1", "2"))],
    )
    assert search(network, "0", "2", 1).itineraries[0].transfers == 1
    assert not search(network, "0", "2", 0).itineraries


def test_transfer_through_walking_edge() -> None:
    network = build_network(
        [
            StopNode("a", 0, 0),
            StopNode("b", 0.02, 0),
            StopNode("c", 0.022, 0),
            StopNode("d", 0.04, 0),
        ],
        [route("one", ("a", "b")), route("two", ("c", "d"))],
    )
    itinerary = search(network, "a", "d", 1).itineraries[0]
    assert itinerary.transfers == 1
    assert 0 < itinerary.walk_m <= 300
    assert not search(network, "a", "d", 0).itineraries


def test_no_walking_edge_for_301_m() -> None:
    network = build_network(
        [StopNode("a", 0, 0), StopNode("b", math.degrees(301 / EARTH_M), 0)], []
    )
    assert not search(network, "a", "b").itineraries


def test_ranking_prefers_transfers_then_cost() -> None:
    network = build_network(
        [StopNode(str(i), i * 0.02, 0) for i in range(5)],
        [
            route("long", ("0", "1", "2", "3")),
            route("short", ("0", "3")),
            route("first", ("0", "4")),
            route("second", ("4", "3")),
        ],
    )
    result = search(network, "0", "3").itineraries
    assert [(item.transfers, item.ride_stops) for item in result] == [(0, 1), (0, 3), (1, 2)]


@pytest.mark.parametrize(("fare", "expected"), [(200, 300), (None, None)])
def test_fare_sum(fare: int | None, expected: int | None) -> None:
    network = build_network(
        [StopNode(str(i), i * 0.02, 0) for i in range(3)],
        [route("one", ("0", "1")), route("two", ("1", "2"), fare)],
    )
    assert search(network, "0", "2").itineraries[0].estimated_fare_minor == expected


def test_timeout_raises_planner_timeout() -> None:
    ticks = iter([0.0, 2.0])
    network = build_network([StopNode("a", 0, 0)], [])
    with pytest.raises(PlannerTimeout):
        plan(network, [("a", 0)], [("a", 0)], 0, deadline=1, now=lambda: next(ticks))


@pytest.mark.parametrize("k", [-1, 3])
def test_invalid_transfer_limit(k: int) -> None:
    with pytest.raises(ValueError, match="transfer"):
        search(build_network([], []), "a", "b", k)


@st.composite
def networks(draw: st.DrawFn) -> Network:
    n = draw(st.integers(5, 40))
    positions = draw(
        st.lists(
            st.tuples(st.integers(0, 30), st.integers(0, 30)),
            min_size=n,
            max_size=n,
        )
    )
    stops = [StopNode(str(i), x * 0.002, y * 0.002) for i, (x, y) in enumerate(positions)]
    paths = draw(
        st.lists(
            st.lists(st.integers(0, n - 1), min_size=2, max_size=min(n, 8), unique=True),
            min_size=1,
            max_size=8,
        )
    )
    lines = [route(str(i), tuple(map(str, path))) for i, path in enumerate(paths)]
    return build_network(stops, lines)


@settings(max_examples=75, deadline=None)
@given(networks())
def test_property_never_exceeds_max_transfers(network: Network) -> None:
    for k in range(3):
        for itinerary in search(network, "0", str(len(network.stops) - 1), k).itineraries:
            assert itinerary.transfers <= k


@settings(max_examples=75, deadline=None)
@given(networks())
def test_property_symmetric_reachability(network: Network) -> None:
    last = str(len(network.stops) - 1)
    for k in range(3):
        assert bool(search(network, "0", last, k).itineraries) == bool(
            search(network, last, "0", k).itineraries
        )


@settings(max_examples=75, deadline=None)
@given(networks())
def test_property_itineraries_are_well_formed(network: Network) -> None:
    result = search(network, "0", str(len(network.stops) - 1))
    assert len(result.itineraries) <= 3
    sequences: set[tuple[str, ...]] = set()
    for itinerary in result.itineraries:
        end: str | None = None
        sequence: list[str] = []
        previous_walk = False
        for leg in itinerary.legs:
            if isinstance(leg, RideLeg):
                assert leg.board_stop == end
                assert leg.board_stop != leg.alight_stop
                assert leg.stop_count > 0
                end = leg.alight_stop
                sequence.append(leg.line_id)
                previous_walk = False
            else:
                assert isinstance(leg, WalkLeg)
                assert not previous_walk
                assert leg.from_stop == end
                end = leg.to_stop
                previous_walk = True
        assert end is None
        assert itinerary.transfers == max(0, len(sequence) - 1)
        assert tuple(sequence) not in sequences
        sequences.add(tuple(sequence))
