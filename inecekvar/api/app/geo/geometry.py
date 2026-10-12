import itertools
import math
from collections.abc import Sequence
from typing import Literal, TypedDict

from geoalchemy2.elements import WKBElement
from geoalchemy2.shape import to_shape
from shapely.geometry import LineString, Point

type Coordinate = tuple[float, float]


class GeoJSONLineString(TypedDict):
    type: Literal["LineString"]
    coordinates: list[list[float]]


class GeoJSONPoint(TypedDict):
    type: Literal["Point"]
    coordinates: list[float]


def point_coordinates(value: WKBElement) -> list[float]:
    shape = to_shape(value)
    if not isinstance(shape, Point):
        raise ValueError("Nokta gerekli.")
    return [float(shape.x), float(shape.y)]


def point_geojson(value: WKBElement) -> GeoJSONPoint:
    return {"type": "Point", "coordinates": point_coordinates(value)}


def line_geojson(value: WKBElement) -> GeoJSONLineString:
    shape = to_shape(value)
    if not isinstance(shape, LineString):
        raise ValueError("Hat geometrisi gerekli.")
    return {"type": "LineString", "coordinates": [[float(x), float(y)] for x, y in shape.coords]}


def bbox_bounds(value: WKBElement) -> list[float]:
    return list(to_shape(value).bounds)


def validate_coordinate(value: Coordinate) -> Coordinate:
    lng, lat = value
    if not math.isfinite(lng) or not math.isfinite(lat) or not -180 <= lng <= 180:
        raise ValueError("Koordinat geçersiz.")
    if not -90 <= lat <= 90:
        raise ValueError("Koordinat geçersiz.")
    return value


def bbox_contains(bbox: WKBElement, coordinates: Sequence[Coordinate]) -> bool:
    polygon = to_shape(bbox)
    return all(polygon.covers(Point(validate_coordinate(point))) for point in coordinates)


def geodesic_length(coordinates: Sequence[Coordinate]) -> float:
    total = 0.0
    for first, second in itertools.pairwise(coordinates):
        lng1, lat1 = map(math.radians, first)
        lng2, lat2 = map(math.radians, second)
        term = math.sin((lat2 - lat1) / 2) ** 2
        term += math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
        total += 6371008.8 * 2 * math.asin(math.sqrt(min(1.0, term)))
    return total


def validate_polyline(coordinates: Sequence[Coordinate]) -> None:
    if not 2 <= len(coordinates) <= 5000 or len(set(coordinates)) < 2:
        raise ValueError("Hat en az iki farklı nokta içermeli.")
    for point in coordinates:
        validate_coordinate(point)
    shape = LineString(coordinates)
    # A simple closed ring is valid; crossing closed rings still fail.
    if not shape.is_valid or not shape.is_simple:
        raise ValueError("Hat kendi kendini kesemez.")
    if geodesic_length(coordinates) > 150000:
        raise ValueError("Hat uzunluğu sınırı aşıldı.")
