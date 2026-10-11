import asyncpg
import pytest

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


async def test_postgis_extension_answers_a_spatial_query(postgis_dsn: str) -> None:
    connection = await asyncpg.connect(postgis_dsn)
    try:
        await connection.execute("CREATE EXTENSION IF NOT EXISTS postgis")
        version = await connection.fetchval("SELECT postgis_lib_version()")
        # Two points 0.01 degrees of latitude apart are about 1.1 km apart on the spheroid.
        distance_m = await connection.fetchval(
            "SELECT ST_Distance("
            "ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, "
            "ST_SetSRID(ST_MakePoint($1, $3), 4326)::geography)",
            29.0,
            41.0,
            41.01,
        )
    finally:
        await connection.close()

    assert str(version).startswith("3.5")
    assert 1100 < float(distance_m) < 1120
