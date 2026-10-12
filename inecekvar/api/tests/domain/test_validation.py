import httpx
import pytest
from geoalchemy2.shape import from_shape
from shapely.geometry import Point, Polygon

from app.core.deps import Services
from app.core.ids import uuid7
from app.models import City, Stop
from tests.domain.conftest import Account, Sample

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


def new_line(sample: Sample) -> dict[str, object]:
    return {
        "kind": "new_line",
        "city": "ornek-test-sehri",
        "code": "T-1",
        "name": "Yeni hat",
        "mode": "dolmus",
        "geometry": [[34.01, 42.51], [34.03, 42.51]],
        "stop_ids": [str(identity) for identity in sample.stop_ids[:2]],
        "payment_methods": ["nakit"],
    }


async def invalid(
    client: httpx.AsyncClient,
    contributor: Account,
    body: dict[str, object],
) -> httpx.Response:
    response = await client.post("/v1/edits", headers=contributor.headers, json=body)
    assert response.status_code == 422
    return response


async def test_outside_bbox(
    client: httpx.AsyncClient,
    sample: Sample,
    contributor: Account,
) -> None:
    body = new_line(sample)
    body["geometry"] = [[34.01, 42.51], [35.0, 42.51]]
    await invalid(client, contributor, body)


async def test_too_long_polyline(
    client: httpx.AsyncClient,
    sample: Sample,
    contributor: Account,
) -> None:
    body = new_line(sample)
    body["geometry"] = [
        [34.001 + row * 0.004, 42.501 + col * 0.076]
        for row in range(25)
        for col in (row % 2, 1 - row % 2)
    ]
    await invalid(client, contributor, body)


async def test_self_intersection(
    client: httpx.AsyncClient,
    sample: Sample,
    contributor: Account,
) -> None:
    body = new_line(sample)
    body["geometry"] = [[34.01, 42.51], [34.09, 42.57], [34.01, 42.57], [34.09, 42.51]]
    await invalid(client, contributor, body)


async def test_too_many_points(
    client: httpx.AsyncClient,
    sample: Sample,
    contributor: Account,
) -> None:
    body = new_line(sample)
    body["geometry"] = [[34.01 + index / 1000000, 42.51] for index in range(5001)]
    await invalid(client, contributor, body)


@pytest.mark.parametrize("fare", [-1, 10000001])
async def test_fare_bounds(
    client: httpx.AsyncClient,
    sample: Sample,
    contributor: Account,
    fare: int,
) -> None:
    body = new_line(sample)
    body["fare_minor"] = fare
    await invalid(client, contributor, body)


async def test_unknown_field(
    client: httpx.AsyncClient,
    sample: Sample,
    contributor: Account,
) -> None:
    body = new_line(sample)
    body["author_id"] = str(contributor.identity)
    await invalid(client, contributor, body)


async def test_unknown_stop(
    client: httpx.AsyncClient,
    sample: Sample,
    contributor: Account,
) -> None:
    body = new_line(sample)
    body["stop_ids"] = [str(sample.stop_ids[0]), str(uuid7())]
    await invalid(client, contributor, body)


async def test_stop_of_another_city(
    client: httpx.AsyncClient,
    sample: Sample,
    contributor: Account,
    services: Services,
) -> None:
    identity = uuid7()
    async with services.session_factory() as db:
        city = City(
            id=uuid7(),
            name="Diğer şehir",
            slug="diger-sehir",
            bbox=from_shape(
                Polygon(((34, 42.5), (34.1, 42.5), (34.1, 42.58), (34, 42.58))),
                srid=4326,
            ),
            centroid=from_shape(Point(34.05, 42.54), srid=4326),
        )
        db.add(city)
        await db.flush()
        db.add(
            Stop(
                id=identity,
                city_id=city.id,
                name="Diğer durak",
                slug="diger-durak",
                location=from_shape(Point(34.01, 42.51), srid=4326),
                kind="formal",
            )
        )
        await db.commit()
    body = new_line(sample)
    body["stop_ids"] = [str(sample.stop_ids[0]), str(identity)]
    await invalid(client, contributor, body)


async def test_control_characters(
    client: httpx.AsyncClient,
    sample: Sample,
    contributor: Account,
) -> None:
    body = new_line(sample)
    body["name"] = "Hat\nAdı"
    await invalid(client, contributor, body)


async def test_empty_diff(client: httpx.AsyncClient, sample: Sample, contributor: Account) -> None:
    response = await invalid(
        client,
        contributor,
        {
            "kind": "fare_update",
            "line": str(sample.line_id),
            "base_version_no": 1,
            "fare_minor": 2500,
        },
    )
    assert response.json()["code"] == "edit.no_change"


async def test_two_distinct_points_required(
    client: httpx.AsyncClient,
    sample: Sample,
    contributor: Account,
) -> None:
    body = new_line(sample)
    body["geometry"] = [[34.01, 42.51], [34.01, 42.51]]
    await invalid(client, contributor, body)


async def test_duplicate_stops_and_payments(
    client: httpx.AsyncClient,
    sample: Sample,
    contributor: Account,
) -> None:
    body = new_line(sample)
    body["stop_ids"] = [str(sample.stop_ids[0])] * 2
    await invalid(client, contributor, body)
    body = new_line(sample)
    body["payment_methods"] = ["nakit", "nakit"]
    await invalid(client, contributor, body)


async def test_normalized_payload_and_diff(
    client: httpx.AsyncClient,
    sample: Sample,
    contributor: Account,
) -> None:
    response = await client.post(
        "/v1/edits",
        headers=contributor.headers,
        json={
            "kind": "update_line",
            "line": str(sample.line_id),
            "base_version_no": 1,
            "changes": {"name": "  Yeni isim  ", "hours_text": None},
        },
    )
    assert response.status_code == 201
    assert response.json()["payload"]["changes"]["name"] == "Yeni isim"
    assert response.json()["diff"]["name"]["to"] == "Yeni isim"
    assert response.json()["diff"]["hours_text"]["to"] is None


async def test_simple_closed_loop_is_accepted(
    client: httpx.AsyncClient,
    sample: Sample,
    contributor: Account,
) -> None:
    body = new_line(sample)
    body["geometry"] = [[34.01, 42.51], [34.03, 42.51], [34.03, 42.53], [34.01, 42.51]]
    response = await client.post("/v1/edits", headers=contributor.headers, json=body)
    assert response.status_code == 201
