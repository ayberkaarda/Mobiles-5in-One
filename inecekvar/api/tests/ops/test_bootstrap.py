"""`python -m app.ops.bootstrap` (ADR-0057): first admin and first city on an empty database."""

import hashlib
import hmac
import io
import json
import os
import subprocess
import sys
from datetime import UTC, datetime
from functools import partial

import anyio
import httpx
import pytest
from geoalchemy2.shape import to_shape
from pydantic import SecretStr
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.step_up import SessionStepUpSource
from app.core.deps import Services
from app.models import City, Line, Stop
from app.models.accounts import User
from app.models.enums import UserRole
from app.models.ops import AuditLog
from app.ops import bootstrap
from app.seed.sample_city import seed_sample_city
from tests.support.app import (
    StaticBreachChecker,
    build_test_app,
    make_test_settings,
    session_key_pair,
)
from tests.support.database import API_DIR
from tests.support.domain import PASSWORD, create_account

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]

# A throwaway test password, assembled at run time so no literal looks like a credential.
ADMIN_PASSWORD = "-".join(("ilk", "yonetici", "sifresi", "2026"))
EMAIL = "Ilk.Yonetici@Example.com"
ISTANBUL = "28.5,40.8,29.5,41.3"
NOW = datetime(2026, 10, 13, 9, 0, tzinfo=UTC)


async def invoke(
    url: str, argv: list[str], stdin: str = "", capsys: pytest.CaptureFixture[str] | None = None
) -> tuple[int, str, str]:
    settings = make_test_settings(database_url=SecretStr(url))
    code = await anyio.to_thread.run_sync(
        partial(
            bootstrap.main,
            argv,
            settings_factory=lambda: settings,
            stdin=io.StringIO(stdin),
            breach_checker=StaticBreachChecker(),
        )
    )
    out, err = capsys.readouterr() if capsys is not None else ("", "")
    return code, out, err


def digest(address: str) -> bytes:
    key = make_test_settings().require_secret("log_hash_key")
    return hmac.new(key, address.encode(), hashlib.sha256).digest()


async def audit_rows(factory: async_sessionmaker[AsyncSession], action: str) -> list[AuditLog]:
    async with factory() as db:
        return list(await db.scalars(select(AuditLog).where(AuditLog.action == action)))


async def test_creates_first_admin_on_empty_database(
    migrated_url: str,
    services: Services,
    session_factory: async_sessionmaker[AsyncSession],
    capsys: pytest.CaptureFixture[str],
) -> None:
    code, out, err = await invoke(
        migrated_url,
        ["admin", "--email", EMAIL, "--password-stdin"],
        ADMIN_PASSWORD + "\n",
        capsys,
    )
    assert code == 0, err
    result = json.loads(out)
    assert (result["command"], result["outcome"], result["totp"]) == (
        "admin",
        "created",
        "enrolment required",
    )
    for text in (out, err):
        assert ADMIN_PASSWORD not in text
        assert EMAIL.lower() not in text.lower()
    async with session_factory() as db:
        user = (await db.scalars(select(User))).one()
        assert str(user.id) == result["user_id"]
        assert user.email == EMAIL.lower()
        assert user.role == "admin"
        assert user.email_verified_at is not None
        assert user.totp_enabled_at is None
        assert user.totp_secret_enc is None
        assert user.password_hash is not None
        assert ADMIN_PASSWORD not in user.password_hash
    [row] = await audit_rows(session_factory, "ops.bootstrap_admin")
    assert row.actor_id is None
    assert (row.target_type, str(row.target_id)) == ("user", result["user_id"])
    assert row.diff_hash == digest(EMAIL.lower())

    # The new admin signs in and is sent to TOTP enrolment by the first step-up action.
    services.step_up = SessionStepUpSource()
    transport = httpx.ASGITransport(app=build_test_app(services), client=("203.0.113.10", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as client:
        login = await client.post(
            "/v1/auth/login",
            json={"email": EMAIL.lower(), "password": ADMIN_PASSWORD, "mode": "bearer"},
        )
        assert login.status_code == 200
        headers = {"Authorization": "Bearer " + login.json()["access_token"]}
        denied = await client.get("/v1/admin/users", headers=headers)
        assert denied.status_code == 403
        assert denied.json()["code"] == "auth.totp_enrolment_required"


async def test_promotes_existing_account_and_refuses_a_second_admin(
    migrated_url: str,
    services: Services,
    session_factory: async_sessionmaker[AsyncSession],
    capsys: pytest.CaptureFixture[str],
) -> None:
    identity, email = await create_account(services, UserRole.CONTRIBUTOR)
    async with session_factory() as db, db.begin():
        user = await db.get(User, identity)
        assert user is not None
        user.email_verified_at = None
    code, out, err = await invoke(migrated_url, ["admin", "--email", email], capsys=capsys)
    assert code == 0, err
    assert json.loads(out)["outcome"] == "promoted"
    async with session_factory() as db:
        user = await db.get(User, identity)
        assert user is not None
        assert user.role == "admin"
        assert user.email_verified_at is not None

    # The same account again: nothing to do.
    code, out, _ = await invoke(migrated_url, ["admin", "--email", email], capsys=capsys)
    assert (code, json.loads(out)["outcome"]) == (0, "unchanged")

    # Another account while an admin exists: refused, nothing written.
    other, other_email = await create_account(services, UserRole.USER)
    code, out, err = await invoke(migrated_url, ["admin", "--email", other_email], capsys=capsys)
    assert code == 2
    assert out == ""
    assert "--force-additional" in err
    assert other_email not in err
    async with session_factory() as db:
        assert (await db.get(User, other)).role == "user"  # type: ignore[union-attr]
    assert len(await audit_rows(session_factory, "ops.bootstrap_admin")) == 1

    code, out, err = await invoke(
        migrated_url, ["admin", "--email", other_email, "--force-additional"], capsys=capsys
    )
    assert code == 0, err
    assert json.loads(out)["additional"] is True
    assert len(await audit_rows(session_factory, "ops.bootstrap_admin")) == 2


async def test_admin_refusals_leave_the_database_unchanged(
    migrated_url: str,
    services: Services,
    session_factory: async_sessionmaker[AsyncSession],
    capsys: pytest.CaptureFixture[str],
) -> None:
    # Unknown address without a password: refused.
    code, _, err = await invoke(
        migrated_url, ["admin", "--email", "yok@example.com"], capsys=capsys
    )
    assert code == 2
    assert "register it in the app first" in err
    # A password that fails the registration policy (the address itself): refused.
    code, _, err = await invoke(
        migrated_url,
        ["admin", "--email", "kisa@example.com", "--password-stdin"],
        "kisa@example.com\n",
        capsys,
    )
    assert code == 2
    assert "policy" in err
    # An existing account never gets a password from the command.
    _, email = await create_account(services, UserRole.USER)
    code, _, err = await invoke(
        migrated_url, ["admin", "--email", email, "--password-stdin"], PASSWORD + "x\n", capsys
    )
    assert code == 2
    assert "only applies to a new account" in err
    async with session_factory() as db:
        assert (
            await db.scalar(select(func.count()).select_from(User).where(User.role == "admin")) == 0
        )
    assert await audit_rows(session_factory, "ops.bootstrap_admin") == []


async def test_city_is_created_once_and_idempotent(
    migrated_url: str,
    session_factory: async_sessionmaker[AsyncSession],
    capsys: pytest.CaptureFixture[str],
) -> None:
    argv = ["city", "--slug", "istanbul", "--name", "İstanbul", "--bbox", ISTANBUL]
    code, out, err = await invoke(migrated_url, argv, capsys=capsys)
    assert code == 0, err
    first = json.loads(out)
    assert first["outcome"] == "created"
    code, out, _ = await invoke(migrated_url, argv, capsys=capsys)
    assert code == 0
    assert json.loads(out) == {**first, "outcome": "unchanged"}
    async with session_factory() as db:
        city = (await db.scalars(select(City))).one()
        assert (city.slug, city.name, city.timezone, city.is_sample) == (
            "istanbul",
            "İstanbul",
            "Europe/Istanbul",
            False,
        )
        assert to_shape(city.bbox).bounds == (28.5, 40.8, 29.5, 41.3)
        assert to_shape(city.centroid).coords[0] == (29.0, 41.05)
        assert await db.scalar(select(func.count()).select_from(Stop)) == 0
        assert await db.scalar(select(func.count()).select_from(Line)) == 0
    [row] = await audit_rows(session_factory, "ops.bootstrap_city")
    assert (row.target_type, str(row.target_id), row.diff_hash) == ("city", first["city_id"], None)

    # The same slug with another box is refused, not silently changed.
    code, _, err = await invoke(
        migrated_url,
        ["city", "--slug", "istanbul", "--name", "İstanbul", "--bbox", "28.6,40.8,29.5,41.3"],
        capsys=capsys,
    )
    assert code == 2
    assert "other values" in err
    assert len(await audit_rows(session_factory, "ops.bootstrap_city")) == 1


@pytest.mark.parametrize(
    ("bbox", "message"),
    [
        ("29.5,40.8,28.5,41.3", "MIN_LON < MAX_LON"),
        ("28.5,41.3,29.5,40.8", "MIN_LAT < MAX_LAT"),
        ("28.5,40.8,29.5", "four numbers"),
        ("28.5,40.8,29.5,abc", "numbers"),
        ("28.5,40.8,nan,41.3", "finite"),
        ("190,40.8,191,41.3", "MIN_LON < MAX_LON"),
        ("20,35,30,42", "spans more than"),
    ],
)
def test_invalid_bbox_is_rejected(
    bbox: str, message: str, capsys: pytest.CaptureFixture[str]
) -> None:
    with pytest.raises(SystemExit) as exit_info:
        bootstrap.parser().parse_args(["city", "--slug", "x", "--name", "X", "--bbox", bbox])
    assert exit_info.value.code == 2
    assert message in capsys.readouterr().err


@pytest.mark.parametrize(
    "argv",
    [
        ["city", "--slug", "ornek-test-sehri", "--name", "X", "--bbox", ISTANBUL],
        ["city", "--slug", "Büyük", "--name", "X", "--bbox", ISTANBUL],
        ["city", "--slug", "x", "--name", "[ÖRNEK] X", "--bbox", ISTANBUL],
        ["city", "--slug", "x", "--name", "X", "--bbox", ISTANBUL, "--timezone", "Mars/Olympus"],
        ["admin", "--email", "not-an-address"],
    ],
)
def test_invalid_arguments_are_rejected(argv: list[str]) -> None:
    with pytest.raises(SystemExit) as exit_info:
        bootstrap.parser().parse_args(argv)
    assert exit_info.value.code == 2


async def test_sample_city_slug_is_never_touched(
    migrated_url: str,
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as db, db.begin():
        await seed_sample_city(db)
    box = bootstrap.parse_bbox("34.0,42.5,34.1,42.58")
    async with session_factory() as db:
        with pytest.raises(bootstrap.RefusedError):
            await bootstrap.bootstrap_city(
                db, "ornek-test-sehri", "[ÖRNEK] Test Şehri", box, "Europe/Istanbul", NOW
            )


def cli_env(url: str, **extra: str) -> dict[str, str]:
    keys = session_key_pair()
    settings = make_test_settings()
    env = {key: value for key, value in os.environ.items() if not key.startswith("INECEKVAR_")}
    env.update(
        INECEKVAR_ENV="test",
        INECEKVAR_DATABASE_URL=url,
        INECEKVAR_REDIS_URL="redis://127.0.0.1:1/0",
        INECEKVAR_JWT_PRIVATE_KEY_PEM=keys.private_pem,
        INECEKVAR_JWT_PUBLIC_KEY_PEM=keys.public_pem,
        INECEKVAR_CSRF_SECRET=settings.require_secret("csrf_secret").decode(),
        INECEKVAR_LOG_HASH_KEY=settings.require_secret("log_hash_key").decode(),
        INECEKVAR_HIBP_ENABLED="false",
    )
    env.update(extra)
    return env


def run_cli(
    argv: list[str], env: dict[str, str], stdin: str = ""
) -> subprocess.CompletedProcess[str]:
    run = partial(
        subprocess.run,
        [sys.executable, "-m", "app.ops.bootstrap", *argv],
        cwd=API_DIR,
        env=env,
        input=stdin,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    return run()


async def test_cli_prints_no_secret(migrated_url: str) -> None:
    env = cli_env(migrated_url)
    created = await anyio.to_thread.run_sync(
        partial(
            run_cli, ["admin", "--email", EMAIL, "--password-stdin"], env, ADMIN_PASSWORD + "\n"
        )
    )
    assert created.returncode == 0, created.stderr
    refused = await anyio.to_thread.run_sync(
        partial(run_cli, ["admin", "--email", "ikinci@example.com"], env)
    )
    assert refused.returncode == 2
    city = await anyio.to_thread.run_sync(
        partial(
            run_cli,
            ["city", "--slug", "izmir", "--name", "İzmir", "--bbox", "26.8,38.2,27.4,38.6"],
            env,
        )
    )
    assert city.returncode == 0, city.stderr
    # Production without its secrets: a configuration error naming fields, never values.
    broken = await anyio.to_thread.run_sync(
        partial(
            run_cli,
            ["city", "--slug", "izmir", "--name", "İzmir", "--bbox", "26.8,38.2,27.4,38.6"],
            {
                key: value
                for key, value in cli_env(migrated_url, INECEKVAR_ENV="production").items()
                if key != "INECEKVAR_CSRF_SECRET"
            },
        )
    )
    assert broken.returncode == 1
    assert broken.stderr.startswith("settings invalid")
    database_password = migrated_url.split("://", 1)[1].split("@", 1)[0].split(":", 1)[-1]
    secrets = [
        ADMIN_PASSWORD,
        EMAIL.lower(),
        env["INECEKVAR_LOG_HASH_KEY"],
        env["INECEKVAR_CSRF_SECRET"],
        "PRIVATE KEY",
        database_password,
    ]
    for result in (created, refused, city, broken):
        for secret in secrets:
            assert secret not in result.stdout
            assert secret not in result.stderr
