import asyncio
import base64
import json
import secrets
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

import httpx
import pytest
from pydantic import SecretStr

from app.core.deps import Services
from app.core.settings import Settings
from app.webhooks.signatures import svix_signature
from tests.domain.conftest import (
    clock,
    contributor,
    migrated_url,
    moderator,
    sample,
    services,
    session_factory,
    user,
)
from tests.support.app import FixedClock, build_test_app

__all__ = [
    "clock",
    "contributor",
    "migrated_url",
    "moderator",
    "sample",
    "services",
    "session_factory",
    "user",
]

RC_SECRET = "rc-webhook-" + "k" * 40
RESEND_KEY = bytes(range(32))
RESEND_SECRET = "whsec_" + base64.b64encode(RESEND_KEY).decode()


@dataclass(slots=True)
class RecordingJobQueue:
    """Records enqueued jobs; `delay` simulates a slow queue, `fail` a broken one."""

    jobs: list[tuple[str, tuple[str, ...], str]] = field(default_factory=list)
    delay: float = 0.0
    fail: bool = False

    async def enqueue(self, function: str, *args: str, job_id: str) -> None:
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.fail:
            raise ConnectionError("queue unavailable")
        self.jobs.append((function, args, job_id))


@pytest.fixture
def queue() -> RecordingJobQueue:
    return RecordingJobQueue()


@pytest.fixture
def webhook_services(services: Services, queue: RecordingJobQueue) -> Services:
    services.settings = services.settings.model_copy(
        update={
            "revenuecat_webhook_secret": SecretStr(RC_SECRET),
            "resend_webhook_secret": SecretStr(RESEND_SECRET),
        }
    )
    services.job_queue = queue
    return services


@pytest.fixture
def settings(webhook_services: Services) -> Settings:
    return webhook_services.settings


@pytest.fixture
async def client(webhook_services: Services) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(
        app=build_test_app(webhook_services), client=("198.51.100.20", 40000)
    )
    async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as connection:
        yield connection


def rc_headers(secret: str = RC_SECRET) -> dict[str, str]:
    return {"Authorization": secret, "Content-Type": "application/json"}


def encode(body: object) -> bytes:
    return json.dumps(body, separators=(",", ":")).encode()


def svix_headers(
    body: bytes,
    clock: FixedClock,
    *,
    message_id: str | None = None,
    offset: int = 0,
    key: bytes = RESEND_KEY,
) -> dict[str, str]:
    identity = message_id or "msg_" + secrets.token_hex(12)
    timestamp = str(int(clock.now().timestamp()) + offset)
    return {
        "svix-id": identity,
        "svix-timestamp": timestamp,
        "svix-signature": "v1," + svix_signature(key, identity, timestamp, body),
        "Content-Type": "application/json",
    }


def resend_event(event_type: str, *recipients: str, bounce: str | None = None) -> dict[str, object]:
    """A Resend webhook body in the documented shape (`type`, `created_at`, `data`)."""
    data: dict[str, object] = {
        "email_id": "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
        "from": "İnecek Var <no-reply@inecekvar.app>",
        "to": list(recipients),
        "subject": "İnecek Var giriş bağlantınız",
        "created_at": "2026-10-12T09:00:00.000Z",
    }
    if bounce is not None:
        data["bounce"] = {"message": "mailbox unavailable", "subType": "General", "type": bounce}
    return {"type": event_type, "created_at": "2026-10-12T09:00:01.000Z", "data": data}
