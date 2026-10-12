import httpx
import pytest

from app.core.storage import ObjectMissingError, ObjectTooLargeError
from tests.support.storage import S3Buckets

pytestmark = [pytest.mark.anyio]


async def test_presigned_put_accepts_exact_length(s3_buckets: S3Buckets) -> None:
    store, bucket = s3_buckets.store, s3_buckets.media_bucket
    url = await store.presign_put(bucket, "incoming/a", "image/jpeg", 5, 60)
    async with httpx.AsyncClient() as client:
        response = await client.put(url, content=b"12345", headers={"Content-Type": "image/jpeg"})
    assert response.status_code == 200
    stored = await store.head(bucket, "incoming/a")
    assert stored is not None
    assert stored.size == 5
    assert stored.content_type == "image/jpeg"


@pytest.mark.parametrize(
    ("body", "content_type"),
    [(b"123456", "image/jpeg"), (b"1234", "image/jpeg"), (b"12345", "image/png")],
    ids=["longer", "shorter", "other-type"],
)
async def test_presigned_put_rejects_other_length_or_type(
    s3_buckets: S3Buckets, body: bytes, content_type: str
) -> None:
    store, bucket = s3_buckets.store, s3_buckets.media_bucket
    url = await store.presign_put(bucket, "incoming/b", "image/jpeg", 5, 60)
    async with httpx.AsyncClient() as client:
        response = await client.put(url, content=body, headers={"Content-Type": content_type})
    assert response.status_code == 403
    assert await store.head(bucket, "incoming/b") is None


async def test_get_put_delete_list(s3_buckets: S3Buckets) -> None:
    store, bucket = s3_buckets.store, s3_buckets.exports_bucket
    await store.put(bucket, "exports/x/1.geojson", b"{}", "application/geo+json")
    assert await store.get(bucket, "exports/x/1.geojson", 10) == b"{}"
    assert await store.list_keys(bucket, "exports/x/") == ["exports/x/1.geojson"]
    with pytest.raises(ObjectTooLargeError):
        await store.get(bucket, "exports/x/1.geojson", 1)
    await store.delete(bucket, "exports/x/1.geojson")
    await store.delete(bucket, "exports/x/1.geojson")
    with pytest.raises(ObjectMissingError):
        await store.get(bucket, "exports/x/1.geojson", 10)
    assert await store.list_keys(bucket, "exports/x/") == []
