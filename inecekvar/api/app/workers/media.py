import io
import uuid
import warnings
from datetime import timedelta

import anyio
import structlog
from PIL import Image, ImageOps
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.deps import Clock
from app.core.settings import Settings
from app.core.storage import ObjectMissingError, ObjectStore
from app.models import Photo

Image.MAX_IMAGE_PIXELS = 40_000_000


def reencode(data: bytes, content_type: str) -> bytes:
    jpeg = data.startswith(b"\xff\xd8\xff")
    webp = data.startswith(b"RIFF") and data[8:12] == b"WEBP"
    if not ((content_type == "image/jpeg" and jpeg) or (content_type == "image/webp" and webp)):
        raise ValueError("Dosya turu gecersiz.")
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(data)) as image:
            image.verify()
        with Image.open(io.BytesIO(data)) as image:
            oriented = ImageOps.exif_transpose(image)
            try:
                rgb = oriented.convert("RGB")
                try:
                    rgb.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
                    # A fresh pixel image has no inherited metadata.
                    clean = Image.new("RGB", rgb.size)
                    try:
                        clean.paste(rgb)
                        output = io.BytesIO()
                        clean.save(output, format="WEBP", quality=80)
                        return output.getvalue()
                    finally:
                        clean.close()
                finally:
                    rgb.close()
            finally:
                oriented.close()


async def process_photo(
    session_factory: async_sessionmaker[AsyncSession],
    store: ObjectStore,
    settings: Settings,
    clock: Clock,
    photo_id: uuid.UUID,
) -> str:
    async with session_factory() as db:
        photo = await db.scalar(select(Photo).where(Photo.id == photo_id).with_for_update())
        if photo is None:
            return "missing"
        if photo.processed_at is not None:
            return photo.moderation_state
        incoming = "incoming/" + str(photo_id)
        data: bytes | None = None
        try:
            data = await store.get(settings.media_bucket, incoming, settings.media_max_bytes)
        except ObjectMissingError:
            if clock.now() < photo.created_at + timedelta(seconds=settings.presign_ttl_seconds):
                return "pending"
        except Exception:
            # Storage reads fail closed; exception text never enters logs.
            structlog.get_logger().warning("photo_read_failed", photo_id=str(photo_id))
        try:
            if data is None:
                raise ValueError("Dosya yok.")
            encoded = await anyio.to_thread.run_sync(reencode, data, photo.content_type)
            if not 1 <= len(encoded) <= settings.media_max_bytes:
                raise ValueError("Dosya boyutu gecersiz.")
            key = "photos/" + str(photo_id) + ".webp"
            await store.put(settings.media_bucket, key, encoded, "image/webp")
            await store.delete(settings.media_bucket, incoming)
            photo.key = key
            photo.content_type = "image/webp"
            photo.byte_size = len(encoded)
        except Exception:
            if data is not None:
                await store.put(
                    settings.media_bucket, "quarantine/" + str(photo_id), data, photo.content_type
                )
            await store.delete(settings.media_bucket, incoming)
            photo.moderation_state = "quarantined"
        photo.processed_at = clock.now()
        photo.updated_at = clock.now()
        await db.commit()
        state = photo.moderation_state
    structlog.get_logger().info("photo_processed", photo_id=str(photo_id), outcome=state)
    return state


async def process_pending_photos(
    session_factory: async_sessionmaker[AsyncSession],
    store: ObjectStore,
    settings: Settings,
    clock: Clock,
) -> int:
    cutoff = clock.now() - timedelta(seconds=settings.presign_ttl_seconds)
    async with session_factory() as db:
        identities = list(
            await db.scalars(
                select(Photo.id)
                .where(Photo.processed_at.is_(None), Photo.created_at <= cutoff)
                .order_by(Photo.id)
            )
        )
    for identity in identities:
        await process_photo(session_factory, store, settings, clock, identity)
    return len(identities)
