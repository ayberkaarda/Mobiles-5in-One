import io
import uuid
from typing import cast

import httpx
import pytest
from PIL import Image

from app.core.deps import Services
from app.models import Photo
from app.workers.media import process_pending_photos, process_photo
from tests.domain.conftest import Account, Sample
from tests.support.app import FixedClock
from tests.support.domain import create_account, sign_in
from tests.support.storage import S3Buckets

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


def configure_store(services: Services, buckets: S3Buckets) -> None:
    services.object_store = buckets.store
    services.settings = services.settings.model_copy(update=buckets.settings_overrides())


def jpeg_bytes(size: tuple[int, int] = (3000, 1800)) -> bytes:
    output = io.BytesIO()
    exif = Image.Exif()
    exif[271] = "Camera"
    exif[34853] = {1: "N", 2: (42.0, 30.0, 0.0), 3: "E", 4: (34.0, 0.0, 0.0)}
    with Image.new("RGB", size, (120, 80, 30)) as image:
        image.save(output, format="JPEG", exif=exif)
    return output.getvalue()


async def presign(
    client: httpx.AsyncClient,
    contributor: Account,
    size: int,
) -> httpx.Response:
    return await client.post(
        "/v1/media/presign",
        headers=contributor.headers,
        json={"kind": "fare_table", "content_type": "image/jpeg", "byte_size": size},
    )


async def put_upload(response: httpx.Response, data: bytes) -> uuid.UUID:
    assert response.status_code == 201
    body = response.json()
    async with httpx.AsyncClient() as uploader:
        uploaded = await uploader.put(body["upload_url"], content=data, headers=body["headers"])
    assert uploaded.status_code == 200
    return uuid.UUID(body["photo_id"])


async def test_presign_put_and_process_strips_exif(
    client: httpx.AsyncClient,
    services: Services,
    contributor: Account,
    s3_buckets: S3Buckets,
) -> None:
    configure_store(services, s3_buckets)
    data = jpeg_bytes()
    identity = await put_upload(await presign(client, contributor, len(data)), data)
    assert (
        await process_photo(
            services.session_factory, s3_buckets.store, services.settings, services.clock, identity
        )
        == "pending"
    )
    key = "photos/" + str(identity) + ".webp"
    encoded = await s3_buckets.store.get(s3_buckets.media_bucket, key, 4 * 1024 * 1024)
    with Image.open(io.BytesIO(encoded)) as image:
        assert image.format == "WEBP"
        assert max(image.size) <= 1600
        assert not image.getexif()
        assert not {"exif", "icc_profile", "xmp"}.intersection(image.info)
    assert await s3_buckets.store.head(s3_buckets.media_bucket, "incoming/" + str(identity)) is None
    async with services.session_factory() as db:
        photo = await db.get(Photo, identity)
        assert photo is not None
        assert photo.processed_at is not None
        assert photo.key == key
        assert photo.content_type == "image/webp"


@pytest.mark.parametrize("kind", ["text", "png"])
async def test_mime_spoof_is_quarantined(
    client: httpx.AsyncClient,
    services: Services,
    contributor: Account,
    s3_buckets: S3Buckets,
    kind: str,
) -> None:
    configure_store(services, s3_buckets)
    data = b"not a picture"
    if kind == "png":
        output = io.BytesIO()
        with Image.new("RGB", (10, 10)) as image:
            image.save(output, format="PNG")
        data = output.getvalue()
    identity = await put_upload(await presign(client, contributor, len(data)), data)
    assert (
        await process_photo(
            services.session_factory, s3_buckets.store, services.settings, services.clock, identity
        )
        == "quarantined"
    )
    assert (
        await s3_buckets.store.get(s3_buckets.media_bucket, "quarantine/" + str(identity), 1024)
        == data
    )


async def test_oversize_rejected_at_presign(
    client: httpx.AsyncClient,
    services: Services,
    contributor: Account,
    s3_buckets: S3Buckets,
) -> None:
    configure_store(services, s3_buckets)
    assert (await presign(client, contributor, 4 * 1024 * 1024 + 1)).status_code == 422


async def test_upload_longer_than_presigned_length_refused(
    client: httpx.AsyncClient,
    services: Services,
    contributor: Account,
    s3_buckets: S3Buckets,
) -> None:
    configure_store(services, s3_buckets)
    response = await presign(client, contributor, 10)
    assert response.status_code == 201
    body = response.json()
    headers = cast(dict[str, str], body["headers"]) | {"Content-Length": "11"}
    async with httpx.AsyncClient() as uploader:
        result = await uploader.put(body["upload_url"], content=b"a" * 11, headers=headers)
    assert result.status_code == 403


async def test_presign_quota_20_per_day(
    client: httpx.AsyncClient,
    services: Services,
    contributor: Account,
    s3_buckets: S3Buckets,
) -> None:
    configure_store(services, s3_buckets)
    for _ in range(20):
        assert (await presign(client, contributor, 10)).status_code == 201
    assert (await presign(client, contributor, 10)).status_code == 429


async def test_presign_requires_licence(
    client: httpx.AsyncClient,
    services: Services,
    s3_buckets: S3Buckets,
) -> None:
    configure_store(services, s3_buckets)
    identity, email = await create_account(services, licence_accepted=False)
    account = Account(identity, await sign_in(client, email))
    assert (await presign(client, account, 10)).status_code == 403


async def test_decompression_bomb_quarantined(
    client: httpx.AsyncClient,
    services: Services,
    contributor: Account,
    s3_buckets: S3Buckets,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configure_store(services, s3_buckets)
    data = jpeg_bytes((100, 100))
    identity = await put_upload(await presign(client, contributor, len(data)), data)
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 6000)
    assert (
        await process_photo(
            services.session_factory, s3_buckets.store, services.settings, services.clock, identity
        )
        == "quarantined"
    )


async def test_missing_upload_waits_until_ttl(
    client: httpx.AsyncClient,
    services: Services,
    contributor: Account,
    s3_buckets: S3Buckets,
    clock: FixedClock,
) -> None:
    configure_store(services, s3_buckets)
    response = await presign(client, contributor, 10)
    identity = uuid.UUID(response.json()["photo_id"])
    assert (
        await process_photo(
            services.session_factory, s3_buckets.store, services.settings, clock, identity
        )
        == "pending"
    )
    clock.advance(seconds=services.settings.presign_ttl_seconds)
    assert (
        await process_pending_photos(
            services.session_factory, s3_buckets.store, services.settings, clock
        )
        == 1
    )
    async with services.session_factory() as db:
        photo = await db.get(Photo, identity)
        assert photo is not None
        assert photo.moderation_state == "quarantined"


async def test_photo_attachment_is_private(
    client: httpx.AsyncClient,
    services: Services,
    contributor: Account,
    sample: Sample,
    s3_buckets: S3Buckets,
) -> None:
    configure_store(services, s3_buckets)
    data = jpeg_bytes((100, 100))
    identity = await put_upload(await presign(client, contributor, len(data)), data)
    body = {
        "kind": "update_line",
        "line": str(sample.line_id),
        "base_version_no": 1,
        "changes": {"fare_minor": 2700},
        "photo_id": str(identity),
    }
    assert (
        await client.post("/v1/edits", json=body, headers=contributor.headers)
    ).status_code == 404
    await process_photo(
        services.session_factory, s3_buckets.store, services.settings, services.clock, identity
    )
    response = await client.post("/v1/edits", json=body, headers=contributor.headers)
    assert response.status_code == 201
    assert "photo_id" not in response.json()["payload"]


async def test_photo_attachment_requires_owner_and_nonquarantined(
    client: httpx.AsyncClient,
    services: Services,
    contributor: Account,
    sample: Sample,
    s3_buckets: S3Buckets,
) -> None:
    configure_store(services, s3_buckets)
    data = jpeg_bytes((100, 100))
    identity = await put_upload(await presign(client, contributor, len(data)), data)
    await process_photo(
        services.session_factory, s3_buckets.store, services.settings, services.clock, identity
    )
    body = {
        "kind": "fare_update",
        "line": str(sample.line_id),
        "base_version_no": 1,
        "fare_minor": 2700,
        "photo_id": str(identity),
    }
    _, email = await create_account(services)
    assert (
        await client.post("/v1/edits", json=body, headers=await sign_in(client, email))
    ).status_code == 404
    async with services.session_factory() as db:
        photo = await db.get(Photo, identity)
        assert photo is not None
        photo.moderation_state = "quarantined"
        await db.commit()
    assert (
        await client.post("/v1/edits", json=body, headers=contributor.headers)
    ).status_code == 404
