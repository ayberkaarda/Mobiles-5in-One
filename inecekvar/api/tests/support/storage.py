"""Object storage test helpers: a real S3 API (MinIO) with fresh buckets per test."""

import uuid
from dataclasses import dataclass
from typing import Any

from pydantic import SecretStr

from app.core.settings import Settings
from app.core.storage import S3ObjectStore
from tests.support.app import make_test_settings


@dataclass(frozen=True, slots=True)
class S3Endpoint:
    url: str
    access_key: str
    secret_key: str


@dataclass(frozen=True, slots=True)
class S3Buckets:
    endpoint: S3Endpoint
    media_bucket: str
    exports_bucket: str
    store: S3ObjectStore

    def settings_overrides(self) -> dict[str, Any]:
        """Pass to `make_test_settings(**overrides)` so the app uses these buckets."""
        return {
            "s3_endpoint_url": self.endpoint.url,
            "s3_region": "us-east-1",
            "s3_access_key_id": SecretStr(self.endpoint.access_key),
            "s3_secret_access_key": SecretStr(self.endpoint.secret_key),
            "media_bucket": self.media_bucket,
            "exports_bucket": self.exports_bucket,
        }

    def settings(self, **overrides: Any) -> Settings:
        values = self.settings_overrides()
        values.update(overrides)
        return make_test_settings(**values)


def create_buckets(endpoint: S3Endpoint) -> S3Buckets:
    suffix = uuid.uuid4().hex[:12]
    media, exports = "media-" + suffix, "exports-" + suffix
    probe = make_test_settings(
        s3_endpoint_url=endpoint.url,
        s3_region="us-east-1",
        s3_access_key_id=SecretStr(endpoint.access_key),
        s3_secret_access_key=SecretStr(endpoint.secret_key),
    )
    store = S3ObjectStore.from_settings(probe)
    store.client.create_bucket(Bucket=media)
    store.client.create_bucket(Bucket=exports)
    return S3Buckets(endpoint=endpoint, media_bucket=media, exports_bucket=exports, store=store)
