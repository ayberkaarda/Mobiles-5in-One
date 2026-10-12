"""Object storage behind one interface (spec section 4: R2 in production, MinIO locally).

`ObjectStore` is the only way the API and the workers touch photos and exports. The S3
implementation runs the blocking boto3 client in a worker thread. Keys are built by the
callers from server-side identifiers only, never from request text.
"""

from dataclasses import dataclass
from functools import partial
from typing import TYPE_CHECKING, Any, Protocol

import anyio
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.settings import Settings

if TYPE_CHECKING:
    from mypy_boto3_s3.client import S3Client


class ObjectMissingError(Exception):
    """The key does not exist."""


class ObjectTooLargeError(Exception):
    """The stored object is larger than the caller allows."""


@dataclass(frozen=True, slots=True)
class StoredObject:
    key: str
    size: int
    content_type: str | None


class ObjectStore(Protocol):
    async def presign_put(
        self, bucket: str, key: str, content_type: str, content_length: int, expires_in: int
    ) -> str:
        """A URL that accepts exactly one PUT with this Content-Type and Content-Length."""
        ...

    async def head(self, bucket: str, key: str) -> StoredObject | None: ...

    async def get(self, bucket: str, key: str, max_bytes: int) -> bytes:
        """The object body; ObjectMissingError or ObjectTooLargeError (checked before reading)."""
        ...

    async def put(self, bucket: str, key: str, data: bytes, content_type: str) -> None: ...

    async def delete(self, bucket: str, key: str) -> None:
        """Idempotent: deleting a missing key succeeds."""
        ...

    async def list_keys(self, bucket: str, prefix: str) -> list[str]: ...


def _missing(error: ClientError) -> bool:
    code = str(error.response.get("Error", {}).get("Code", ""))
    return code in {"404", "NoSuchKey", "NotFound"}


class S3ObjectStore:
    def __init__(self, client: "S3Client") -> None:
        self.client = client

    @classmethod
    def from_settings(cls, settings: Settings) -> "S3ObjectStore":
        if settings.s3_endpoint_url is None:
            raise RuntimeError("INECEKVAR_S3_ENDPOINT_URL is not configured")
        access = settings.s3_access_key_id
        secret = settings.s3_secret_access_key
        client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            region_name=settings.s3_region,
            aws_access_key_id=access.get_secret_value() if access is not None else None,
            aws_secret_access_key=secret.get_secret_value() if secret is not None else None,
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )
        return cls(client)

    async def presign_put(
        self, bucket: str, key: str, content_type: str, content_length: int, expires_in: int
    ) -> str:
        params: dict[str, Any] = {
            "Bucket": bucket,
            "Key": key,
            "ContentType": content_type,
            "ContentLength": content_length,
        }
        call = partial(
            self.client.generate_presigned_url,
            "put_object",
            Params=params,
            ExpiresIn=expires_in,
            HttpMethod="PUT",
        )
        return await anyio.to_thread.run_sync(call)

    async def head(self, bucket: str, key: str) -> StoredObject | None:
        try:
            response = await anyio.to_thread.run_sync(
                partial(self.client.head_object, Bucket=bucket, Key=key)
            )
        except ClientError as error:
            if _missing(error):
                return None
            raise
        return StoredObject(
            key=key,
            size=int(response.get("ContentLength", 0)),
            content_type=response.get("ContentType"),
        )

    async def get(self, bucket: str, key: str, max_bytes: int) -> bytes:
        stored = await self.head(bucket, key)
        if stored is None:
            raise ObjectMissingError(key)
        if stored.size > max_bytes:
            raise ObjectTooLargeError(key)

        def read() -> bytes:
            body = self.client.get_object(Bucket=bucket, Key=key)["Body"]
            try:
                data = body.read(max_bytes + 1)
            finally:
                body.close()
            return data

        try:
            data = await anyio.to_thread.run_sync(read)
        except ClientError as error:
            if _missing(error):
                raise ObjectMissingError(key) from error
            raise
        if len(data) > max_bytes:
            raise ObjectTooLargeError(key)
        return data

    async def put(self, bucket: str, key: str, data: bytes, content_type: str) -> None:
        await anyio.to_thread.run_sync(
            partial(
                self.client.put_object,
                Bucket=bucket,
                Key=key,
                Body=data,
                ContentType=content_type,
            )
        )

    async def delete(self, bucket: str, key: str) -> None:
        await anyio.to_thread.run_sync(partial(self.client.delete_object, Bucket=bucket, Key=key))

    async def list_keys(self, bucket: str, prefix: str) -> list[str]:
        def collect() -> list[str]:
            keys: list[str] = []
            paginator = self.client.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
                keys.extend(str(item["Key"]) for item in page.get("Contents", []))
            return keys

        return await anyio.to_thread.run_sync(collect)
