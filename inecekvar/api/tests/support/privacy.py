from collections.abc import Sequence

FORBIDDEN_KEYS = frozenset(
    {
        "traces",
        "trace",
        "trace_id",
        "points",
        "linked_edit_id",
        "author_id",
        "published_by",
        "source_edit_id",
        "email",
    }
)


def assert_no_trace_leak(body: object, raw_points: Sequence[Sequence[float]]) -> None:
    if isinstance(body, dict):
        assert not FORBIDDEN_KEYS.intersection(body)
        for value in body.values():
            assert_no_trace_leak(value, raw_points)
    elif isinstance(body, list):
        if len(body) >= 2 and all(isinstance(value, int | float) for value in body[:2]):
            for raw in raw_points:
                assert not (abs(body[0] - raw[0]) <= 1e-9 and abs(body[1] - raw[1]) <= 1e-9)
        for value in body:
            assert_no_trace_leak(value, raw_points)
