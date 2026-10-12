import re
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import select, text

from app.core.deps import OutgoingMail, Services
from app.core.ids import uuid7
from app.models.accounts import DeletionRequest, Favorite, MagicLink, User, UserSession
from app.models.billing import PackDownload, Subscription
from app.models.contributions import Edit, Photo, Trace
from app.models.geo import Line, LineVersion
from app.models.ops import AuditLog
from app.workers.deletion import hard_delete_due
from tests.domain.conftest import Account, Sample
from tests.support.app import FixedClock, RecordingMailSender
from tests.support.billing import RecordingSubscriberDeleter
from tests.support.domain import PASSWORD, create_account, sign_in
from tests.support.storage import S3Buckets
from tests.traces.test_traces import RAW, upload

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


async def schedule(client: httpx.AsyncClient, headers: dict[str, str]) -> None:
    response = await client.request(
        "DELETE", "/v1/me", json={"password": PASSWORD}, headers=headers
    )
    assert response.status_code == 202


async def login(
    client: httpx.AsyncClient, services: Services, email: str, mode: str
) -> httpx.Response:
    if mode == "password":
        return await client.post(
            "/v1/auth/login", json={"email": email, "password": PASSWORD, "mode": "bearer"}
        )
    assert (await client.post("/v1/auth/magic-link", json={"email": email})).status_code == 202
    mail = services.mail_sender
    assert isinstance(mail, RecordingMailSender)
    match = re.search(r"#token=([A-Za-z0-9_-]+)", mail.sent[-1].text)
    assert match is not None
    return await client.post(
        "/v1/auth/magic-link/verify", json={"token": match.group(1), "mode": "bearer"}
    )


@pytest.mark.parametrize("mode", ["password", "magic"])
async def test_login_during_grace_cancels_deletion(
    client: httpx.AsyncClient, services: Services, clock: FixedClock, mode: str
) -> None:
    identity, email = await create_account(services)
    await schedule(client, await sign_in(client, email))
    clock.advance(days=6)
    assert (await login(client, services, email, mode)).status_code == 200
    async with services.session_factory() as db:
        user = await db.get(User, identity)
        assert user is not None
        assert user.deactivated_at is None
        request = await db.scalar(
            select(DeletionRequest).where(DeletionRequest.user_id == identity)
        )
        assert request is not None
        assert request.state == "cancelled"
        assert request.cancelled_at == clock.now()
        audit = await db.scalar(
            select(AuditLog).where(AuditLog.action == "account.delete_cancelled")
        )
        assert audit is not None
        assert audit.actor_id == identity


@pytest.mark.parametrize("mode", ["password", "magic"])
@pytest.mark.parametrize("scheduled", [True, False])
async def test_login_after_grace_is_refused(
    client: httpx.AsyncClient,
    services: Services,
    clock: FixedClock,
    mode: str,
    scheduled: bool,
) -> None:
    identity, email = await create_account(services)
    if scheduled:
        await schedule(client, await sign_in(client, email))
        clock.advance(days=7)
    else:
        async with services.session_factory() as db:
            user = await db.get(User, identity)
            assert user is not None
            user.deactivated_at = clock.now()
            await db.commit()
    result = await login(client, services, email, mode)
    assert result.status_code == 401
    expected = "auth.invalid_credentials" if mode == "password" else "auth.token_invalid"
    assert result.json()["code"] == expected


async def assert_no_residue(services: Services, needles: list[str]) -> None:
    async with services.session_factory() as db:
        # PostgreSQL quotes every schema, table and column identifier from its own catalog.
        queries = list(
            await db.scalars(
                text(
                    "SELECT format('SELECT EXISTS (SELECT 1 FROM %I.%I "
                    "WHERE strpos(%I::text, \\:needle) > 0)', "
                    "table_schema, table_name, column_name) "
                    "FROM information_schema.columns WHERE table_schema = 'public'"
                )
            )
        )
        for query in queries:
            for needle in needles:
                assert not await db.scalar(text(query), {"needle": needle})


async def test_hard_delete_leaves_no_pii_residue(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    clock: FixedClock,
    s3_buckets: S3Buckets,
) -> None:
    services.settings = services.settings.model_copy(update=s3_buckets.settings_overrides())
    services.object_store = s3_buckets.store
    identity, email = await create_account(services)
    headers = await sign_in(client, email)
    photo_id, approved_id = uuid7(), uuid7()
    display_name = "Silinecek " + identity.hex
    provider_id = "subscriber-" + identity.hex
    keys = [
        "photos/" + str(photo_id) + ".webp",
        "incoming/" + str(photo_id),
        "quarantine/" + str(photo_id),
    ]
    for key in keys:
        await s3_buckets.store.put(s3_buckets.media_bucket, key, b"photo", "image/webp")
    async with services.session_factory() as db:
        user = await db.get(User, identity)
        assert user is not None
        user.display_name = display_name
        photo = Photo(
            id=photo_id,
            owner_id=identity,
            key=keys[0],
            kind="fare_table",
            content_type="image/webp",
            byte_size=5,
        )
        db.add(photo)
        await db.flush()
        approved = Edit(
            id=approved_id,
            kind="fare_update",
            city_id=sample.city_id,
            line_id=sample.line_id,
            author_id=identity,
            state="approved",
            reviewed_at=clock.now(),
            payload={},
            photo_id=photo_id,
        )
        db.add(approved)
        await db.flush()
        line = await db.get(Line, sample.line_id)
        assert line is not None
        current = await db.get(LineVersion, line.current_version_id)
        assert current is not None
        # Line versions are immutable: the approved edit publishes a new version.
        version = LineVersion(
            id=uuid7(),
            line_id=line.id,
            version_no=current.version_no + 1,
            geom=current.geom,
            fare_minor=current.fare_minor,
            payment_methods=list(current.payment_methods),
            stop_ids=list(current.stop_ids),
            source_edit_id=approved_id,
            published_by=identity,
            published_at=clock.now(),
        )
        db.add(version)
        await db.flush()
        version_id = version.id
        db.add_all(
            [
                Edit(
                    kind="fare_update",
                    city_id=sample.city_id,
                    line_id=sample.line_id,
                    author_id=identity,
                    state="pending",
                    payload={"personal_note": email},
                ),
                Subscription(
                    user_id=identity,
                    rc_app_user_id=provider_id,
                    product_id="plus",
                    status="active",
                ),
                Favorite(user_id=identity, line_id=sample.line_id),
                PackDownload(user_id=identity, city_id=sample.city_id, day=clock.now().date()),
                MagicLink(
                    email=email,
                    user_id=None,
                    token_hash=uuid7().bytes + uuid7().bytes,
                    expires_at=clock.now() + timedelta(days=20),
                    created_at=clock.now(),
                ),
                UserSession(
                    user_id=identity,
                    token_hash=uuid7().bytes + uuid7().bytes,
                    expires_at=clock.now() + timedelta(days=20),
                    created_at=clock.now(),
                ),
                Trace(
                    author_id=identity,
                    city_id=sample.city_id,
                    points=RAW,
                    started_at=clock.now(),
                    ended_at=clock.now(),
                ),
                AuditLog(
                    actor_id=identity,
                    action="profile.changed",
                    target_type="user",
                    target_id=identity,
                ),
            ]
        )
        await db.commit()
    await schedule(client, headers)
    clock.advance(days=7)
    deleter = RecordingSubscriberDeleter()
    summary = await hard_delete_due(
        services.session_factory,
        s3_buckets.store,
        services.settings,
        clock,
        services.mail_sender,
        deleter,
    )
    assert summary == {"deleted": 1, "deferred": 0}
    assert sorted(deleter.calls) == sorted([provider_id, str(identity)])
    await assert_no_residue(services, [str(identity), email, display_name])
    async with services.session_factory() as db:
        kept = await db.get(Edit, approved_id)
        assert kept is not None
        assert kept.author_id is None
        assert kept.photo_id is None
        published = await db.get(LineVersion, version_id)
        assert published is not None
        assert published.published_by is None
        assert published.source_edit_id == approved_id
        audit = await db.scalar(select(AuditLog).where(AuditLog.action == "account.deleted"))
        assert audit is not None
        assert audit.actor_id is None
        assert audit.target_id is None
    for key in keys:
        assert await s3_buckets.store.head(s3_buckets.media_bucket, key) is None
    mail = services.mail_sender
    assert isinstance(mail, RecordingMailSender)
    assert mail.sent[-1].to == email
    assert mail.sent[-1].subject == "İnecek Var hesabın silindi"


async def test_private_trace_deleted_immediately(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    contributor: Account,
    clock: FixedClock,
) -> None:
    trace_id = await upload(client, contributor, clock)
    await schedule(client, contributor.headers)
    async with services.session_factory() as db:
        assert await db.get(Trace, trace_id) is None


async def test_hard_delete_defers_when_subscriber_deletion_fails(
    client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    identity, email = await create_account(services)
    async with services.session_factory() as db:
        db.add(
            Subscription(
                user_id=identity, rc_app_user_id="billing-user", product_id="plus", status="active"
            )
        )
        await db.commit()
    await schedule(client, await sign_in(client, email))
    clock.advance(days=7)
    for deleter in (None, RecordingSubscriberDeleter({"billing-user"})):
        summary = await hard_delete_due(
            services.session_factory, None, services.settings, clock, services.mail_sender, deleter
        )
        assert summary == {"deleted": 0, "deferred": 1}
        async with services.session_factory() as db:
            assert await db.get(User, identity) is not None
            request = await db.scalar(select(DeletionRequest))
            assert request is not None
            assert request.state == "scheduled"
            assert await db.scalar(select(Subscription.id)) is not None
    assert deleter is not None
    assert "billing-user" in deleter.calls


async def test_hard_delete_skips_cancelled_request(
    client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    identity, email = await create_account(services)
    await schedule(client, await sign_in(client, email))
    assert (await login(client, services, email, "password")).status_code == 200
    clock.advance(days=8)
    deleter = RecordingSubscriberDeleter()
    assert await hard_delete_due(
        services.session_factory, None, services.settings, clock, services.mail_sender, deleter
    ) == {"deleted": 0, "deferred": 0}
    assert deleter.calls == []
    async with services.session_factory() as db:
        assert await db.get(User, identity) is not None


async def test_wrong_password_does_not_cancel_deletion(
    client: httpx.AsyncClient, services: Services
) -> None:
    identity, email = await create_account(services)
    await schedule(client, await sign_in(client, email))
    response = await client.post(
        "/v1/auth/login",
        json={"email": email, "password": "incorrect-password", "mode": "bearer"},
    )
    assert response.status_code == 401
    async with services.session_factory() as db:
        user = await db.get(User, identity)
        request = await db.scalar(select(DeletionRequest))
        assert user is not None
        assert user.deactivated_at is not None
        assert request is not None
        assert request.state == "scheduled"


class FailingMailSender:
    async def send(self, mail: OutgoingMail) -> None:
        raise RuntimeError("Mail delivery failed")


async def test_photo_storage_deferral_and_mail_failure_retry(
    client: httpx.AsyncClient,
    services: Services,
    clock: FixedClock,
    s3_buckets: S3Buckets,
) -> None:
    services.settings = services.settings.model_copy(update=s3_buckets.settings_overrides())
    identity, email = await create_account(services)
    photo_id = uuid7()
    key = "photos/" + str(photo_id) + ".webp"
    await s3_buckets.store.put(s3_buckets.media_bucket, key, b"photo", "image/webp")
    async with services.session_factory() as db:
        db.add(
            Photo(
                id=photo_id,
                owner_id=identity,
                key=key,
                kind="fare_table",
                content_type="image/webp",
                byte_size=5,
            )
        )
        await db.commit()
    await schedule(client, await sign_in(client, email))
    clock.advance(days=7)
    assert await hard_delete_due(
        services.session_factory, None, services.settings, clock, services.mail_sender, None
    ) == {"deleted": 0, "deferred": 1}
    assert await s3_buckets.store.head(s3_buckets.media_bucket, key) is not None
    assert await hard_delete_due(
        services.session_factory,
        s3_buckets.store,
        services.settings,
        clock,
        FailingMailSender(),
        None,
    ) == {"deleted": 1, "deferred": 0}
    assert await s3_buckets.store.head(s3_buckets.media_bucket, key) is None
    await assert_no_residue(services, [str(identity), email])
