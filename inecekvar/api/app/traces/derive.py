import math
from collections.abc import Sequence
from itertools import pairwise

from shapely.geometry import LineString

from app.core.errors import ProblemError
from app.geo import Coordinate, geodesic_length

TRIM_METRES = 200
SIMPLIFY_DEGREES = 5 / 111195


def interpolate(first: Coordinate, second: Coordinate, fraction: float) -> Coordinate:
    vectors: list[tuple[float, float, float]] = []
    for lng, lat in (first, second):
        lon, phi = math.radians(lng), math.radians(lat)
        vectors.append(
            (
                math.cos(phi) * math.cos(lon),
                math.cos(phi) * math.sin(lon),
                math.sin(phi),
            )
        )
    a, b = vectors
    angle = math.acos(max(-1.0, min(1.0, sum(x * y for x, y in zip(a, b, strict=True)))))
    if angle < 1e-12:
        return first
    left = math.sin((1 - fraction) * angle) / math.sin(angle)
    right = math.sin(fraction * angle) / math.sin(angle)
    x, y, z = (left * v + right * w for v, w in zip(a, b, strict=True))
    return math.degrees(math.atan2(y, x)), math.degrees(math.atan2(z, math.hypot(x, y)))


def derive_line_geometry(points: Sequence[Sequence[float]]) -> list[Coordinate]:
    coordinates = [(float(point[0]), float(point[1])) for point in points]
    total = geodesic_length(coordinates)
    if total - 2 * TRIM_METRES < 100:
        raise ProblemError("trace.too_short", 422)
    result: list[Coordinate] = []
    travelled = 0.0
    end = total - TRIM_METRES
    for first, second in pairwise(coordinates):
        length = geodesic_length([first, second])
        next_distance = travelled + length
        if length > 0 and next_distance > TRIM_METRES and travelled < end:
            start_fraction = max(0.0, (TRIM_METRES - travelled) / length)
            end_fraction = min(1.0, (end - travelled) / length)
            start_point = interpolate(first, second, start_fraction)
            end_point = interpolate(first, second, end_fraction)
            if not result or result[-1] != start_point:
                result.append(start_point)
            if result[-1] != end_point:
                result.append(end_point)
        travelled = next_distance
    simplified = LineString(result).simplify(SIMPLIFY_DEGREES, preserve_topology=False)
    derived = [(float(x), float(y)) for x, y in simplified.coords]
    if geodesic_length(derived) < 100:
        raise ProblemError("trace.too_short", 422)
    return derived
