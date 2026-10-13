"""First-run tools for a fresh database (release checklist section 7, ADR-0057).

    uv run python -m app.ops.bootstrap admin (--email ADDRESS | --email-stdin)
        [--password-stdin] [--force-additional]
    uv run python -m app.ops.bootstrap city --slug SLUG --name NAME
        --bbox MIN_LON,MIN_LAT,MAX_LON,MAX_LAT [--timezone Europe/Istanbul]

`admin` promotes the account with that address to `admin`, or creates it when it does not exist
(creation needs `--password-stdin`: the password is read from the first line of stdin, checked
against the registration policy and stored as an Argon2id hash; it is never an argument, so it
stays out of the shell history and the process list). It refuses while another active admin
exists unless `--force-additional` is given; promoting an account that is already admin changes
nothing. The account is marked email-verified, earlier step-ups are revoked, and TOTP is not
touched: an admin without TOTP is refused every step-up action with
`auth.totp_enrolment_required` until the enrolment on the admin UI (ADR-0037).

The address can stay out of the shell history and the process list too (phase 6 review F15):
`--email-stdin` reads it from the first line of stdin (the password, with `--password-stdin`,
then comes from the second line), and without `--email` or `--email-stdin` the command reads
`INECEKVAR_BOOTSTRAP_EMAIL`. Every stdin line is read with a bound of `STDIN_LINE_MAX`
characters; a longer line is refused.

`city` creates an empty, non-sample city (no stops, no lines). The same slug with the same name,
bounding box and time zone is a no-op; a different one, or the sample city's slug, is refused.

Both write one audit row without personal data (`ops.bootstrap_admin` with the account id and a
keyed digest of the address in `diff_hash`; `ops.bootstrap_city` with the city id) and print one
JSON line on stdout. Nothing printed contains the address, the password, a key or the database
URL. Settings come from the API environment (`app/core/settings.py`): with
`INECEKVAR_ENV=production` every required API secret must be present, as for the API itself;
the command runs against `INECEKVAR_DATABASE_URL` and digests with `INECEKVAR_LOG_HASH_KEY`.
Exit codes: 0 done or unchanged, 2 refused (nothing written), 1 configuration error.
"""

import argparse
import asyncio
import hashlib
import hmac
import json
import math
import os
import re
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TextIO
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from geoalchemy2.shape import from_shape, to_shape
from pydantic import ValidationError
from shapely.geometry import Point, Polygon
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.hibp import HibpRangeClient
from app.auth.passwords import check_password_policy, hash_password
from app.auth.step_up import revoke_user_step_ups
from app.core.deps import BreachChecker
from app.core.errors import ProblemError
from app.core.settings import Settings, load_settings
from app.models.accounts import User
from app.models.enums import UserRole
from app.models.geo import City
from app.models.ops import AuditLog
from app.models.session import create_engine, create_session_factory
from app.security.admins import lock_admins
from app.seed.sample_city import CITY_SLUG as SAMPLE_CITY_SLUG

SLUG = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
# A city box wider than this is a typo, not a city (Istanbul spans about 1.5 by 0.6 degrees).
MAX_BBOX_SPAN_DEGREES = 3.0
EMAIL_MAX = 320
NAME_MAX = 120
SLUG_MAX = 80


class RefusedError(Exception):
    """A refusal that leaves the database unchanged (exit code 2)."""


@dataclass(frozen=True)
class Bbox:
    min_lon: float
    min_lat: float
    max_lon: float
    max_lat: float

    def polygon(self) -> Polygon:
        return Polygon(
            (
                (self.min_lon, self.min_lat),
                (self.max_lon, self.min_lat),
                (self.max_lon, self.max_lat),
                (self.min_lon, self.max_lat),
            )
        )

    def centre(self) -> Point:
        return Point((self.min_lon + self.max_lon) / 2, (self.min_lat + self.max_lat) / 2)


def parse_bbox(value: str) -> Bbox:
    parts = value.split(",")
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("bbox needs four numbers: MIN_LON,MIN_LAT,MAX_LON,MAX_LAT")
    try:
        numbers = [float(part) for part in parts]
    except ValueError:
        raise argparse.ArgumentTypeError("bbox values must be numbers") from None
    if not all(math.isfinite(number) for number in numbers):
        raise argparse.ArgumentTypeError("bbox values must be finite")
    box = Bbox(*numbers)
    if not (-180 <= box.min_lon < box.max_lon <= 180):
        raise argparse.ArgumentTypeError("longitudes must satisfy -180 <= MIN_LON < MAX_LON <= 180")
    if not (-90 <= box.min_lat < box.max_lat <= 90):
        raise argparse.ArgumentTypeError("latitudes must satisfy -90 <= MIN_LAT < MAX_LAT <= 90")
    if (
        box.max_lon - box.min_lon > MAX_BBOX_SPAN_DEGREES
        or box.max_lat - box.min_lat > MAX_BBOX_SPAN_DEGREES
    ):
        raise argparse.ArgumentTypeError(
            f"bbox spans more than {MAX_BBOX_SPAN_DEGREES:g} degrees; check the order of values"
        )
    return box


def parse_slug(value: str) -> str:
    if len(value) > SLUG_MAX or SLUG.fullmatch(value) is None:
        raise argparse.ArgumentTypeError("slug: lowercase a-z, 0-9 and single hyphens, at most 80")
    if value == SAMPLE_CITY_SLUG:
        raise argparse.ArgumentTypeError("the sample city slug is reserved for the sample seed")
    return value


def parse_name(value: str) -> str:
    name = value.strip()
    if not 1 <= len(name) <= NAME_MAX:
        raise argparse.ArgumentTypeError("name: 1 to 120 characters")
    if "[ÖRNEK]" in name.upper():
        raise argparse.ArgumentTypeError("the [ÖRNEK] prefix marks sample data only")
    return name


def parse_timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise argparse.ArgumentTypeError("unknown IANA time zone") from None
    return value


def parse_email(value: str) -> str:
    address = value.strip().lower()
    if len(address) > EMAIL_MAX or EMAIL.fullmatch(address) is None:
        raise argparse.ArgumentTypeError("not an e-mail address")
    return address


# A bound for every stdin line (address or password); the registration policy is far shorter.
STDIN_LINE_MAX = 1024
TOO_LONG = f"refused: stdin line longer than {STDIN_LINE_MAX} characters"
BOOTSTRAP_EMAIL_ENV = "INECEKVAR_BOOTSTRAP_EMAIL"


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="python -m app.ops.bootstrap")
    commands = root.add_subparsers(dest="command", required=True)
    admin = commands.add_parser("admin", help="create or promote the first admin")
    source = admin.add_mutually_exclusive_group()
    source.add_argument("--email", type=parse_email)
    source.add_argument(
        "--email-stdin",
        action="store_true",
        help="read the address from the first line of stdin (a password from the second)",
    )
    admin.add_argument(
        "--password-stdin",
        action="store_true",
        help="read the password of a new account from the first line of stdin",
    )
    admin.add_argument(
        "--force-additional",
        action="store_true",
        help="allow a further admin while another active admin exists",
    )
    city = commands.add_parser("city", help="create an empty, non-sample city")
    city.add_argument("--slug", type=parse_slug, required=True)
    city.add_argument("--name", type=parse_name, required=True)
    city.add_argument("--bbox", type=parse_bbox, required=True)
    city.add_argument("--timezone", type=parse_timezone, default="Europe/Istanbul")
    return root


def email_digest(settings: Settings, address: str) -> bytes:
    return hmac.new(
        settings.require_secret("log_hash_key"), address.encode(), hashlib.sha256
    ).digest()


async def bootstrap_admin(
    db: AsyncSession,
    settings: Settings,
    address: str,
    password: str | None,
    force_additional: bool,
    breach_checker: BreachChecker,
    now: datetime,
) -> dict[str, object]:
    admins = await lock_admins(db)
    user = await db.scalar(select(User).where(User.email == address).with_for_update())
    if user is not None and user.deactivated_at is not None:
        raise RefusedError("the account is deactivated (deletion requested); nothing changed")
    if user is not None and password is not None:
        raise RefusedError("the account exists; --password-stdin only applies to a new account")
    if user is not None and user.role == UserRole.ADMIN.value:
        return {"command": "admin", "outcome": "unchanged", "user_id": str(user.id)}
    if admins and not force_additional:
        raise RefusedError(
            f"{len(admins)} active admin(s) exist; add further admins in the admin UI "
            "or pass --force-additional"
        )
    if user is None:
        if password is None:
            raise RefusedError(
                "no account with this address; register it in the app first "
                "or pass --password-stdin to create it"
            )
        try:
            await check_password_policy(password, address, breach_checker, settings)
        except ProblemError:
            raise RefusedError("the password does not meet the registration policy") from None
        user = User(
            email=address,
            password_hash=await hash_password(password, settings),
            role=UserRole.ADMIN.value,
            email_verified_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add(user)
        await db.flush()
        outcome = "created"
    else:
        user.role = UserRole.ADMIN.value
        if user.email_verified_at is None:
            user.email_verified_at = now
        user.updated_at = now
        outcome = "promoted"
    # Earlier step-ups belong to the previous role; the first admin action asks again.
    await revoke_user_step_ups(db, user.id)
    db.add(
        AuditLog(
            actor_id=None,
            action="ops.bootstrap_admin",
            target_type="user",
            target_id=user.id,
            diff_hash=email_digest(settings, address),
            created_at=now,
            updated_at=now,
        )
    )
    return {
        "command": "admin",
        "outcome": outcome,
        "user_id": str(user.id),
        "totp": "enabled" if user.totp_enabled_at is not None else "enrolment required",
        "additional": bool(admins),
    }


async def bootstrap_city(
    db: AsyncSession, slug: str, name: str, bbox: Bbox, timezone: str, now: datetime
) -> dict[str, object]:
    city = await db.scalar(select(City).where(City.slug == slug).with_for_update())
    if city is not None:
        same = (
            not city.is_sample
            and city.name == name
            and city.timezone == timezone
            and to_shape(city.bbox).equals(bbox.polygon())
        )
        if not same:
            raise RefusedError("a city with this slug exists with other values; nothing changed")
        return {"command": "city", "outcome": "unchanged", "city_id": str(city.id), "slug": slug}
    city = City(
        name=name,
        slug=slug,
        bbox=from_shape(bbox.polygon(), srid=4326),
        centroid=from_shape(bbox.centre(), srid=4326),
        timezone=timezone,
        is_sample=False,
        created_at=now,
        updated_at=now,
    )
    db.add(city)
    await db.flush()
    db.add(
        AuditLog(
            actor_id=None,
            action="ops.bootstrap_city",
            target_type="city",
            target_id=city.id,
            created_at=now,
            updated_at=now,
        )
    )
    return {"command": "city", "outcome": "created", "city_id": str(city.id), "slug": slug}


async def run(
    args: argparse.Namespace,
    settings: Settings,
    password: str | None,
    breach_checker: BreachChecker,
    now: datetime,
) -> dict[str, object]:
    if settings.database_url is None:
        raise RuntimeError("INECEKVAR_DATABASE_URL is required")
    if args.command == "admin":
        settings.require_secret("log_hash_key")
    engine = create_engine(settings.database_url.get_secret_value())
    try:
        factory = create_session_factory(engine)
        async with factory.begin() as db:
            if args.command == "admin":
                return await bootstrap_admin(
                    db, settings, args.email, password, args.force_additional, breach_checker, now
                )
            return await bootstrap_city(db, args.slug, args.name, args.bbox, args.timezone, now)
    finally:
        await engine.dispose()


def settings_from_environment() -> Settings:
    return load_settings()


def main(
    argv: Sequence[str] | None = None,
    *,
    settings_factory: Callable[[], Settings] = settings_from_environment,
    stdin: TextIO | None = None,
    breach_checker: BreachChecker | None = None,
    clock: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> int:
    args = parser().parse_args(argv)
    try:
        settings = settings_factory()
    except ValidationError as error:
        # Only the field names and messages: pydantic would otherwise echo the input values.
        fields = sorted(
            {".".join(str(part) for part in item["loc"]) or "settings" for item in error.errors()}
        )
        print("settings invalid: " + ", ".join(fields), file=sys.stderr)
        return 1
    password: str | None = None
    source = stdin or sys.stdin

    def read_line() -> str | None:
        """One bounded line of stdin without its end; None when it is too long."""
        line = source.readline(STDIN_LINE_MAX + 2).rstrip("\r\n")
        return None if len(line) > STDIN_LINE_MAX else line

    if args.command == "admin":
        raw: str | None
        if args.email_stdin:
            raw = read_line()
            if raw is None:
                print(
                    f"refused: stdin line longer than {STDIN_LINE_MAX} characters", file=sys.stderr
                )
                return 2
        elif args.email is None:
            raw = os.environ.get(BOOTSTRAP_EMAIL_ENV, "")
        else:
            raw = args.email
        try:
            args.email = parse_email(raw or "")
        except argparse.ArgumentTypeError:
            print(
                "refused: no valid address (--email, --email-stdin or " + BOOTSTRAP_EMAIL_ENV + ")",
                file=sys.stderr,
            )
            return 2
    if args.command == "admin" and args.password_stdin:
        line = read_line()
        if line is None:
            print(TOO_LONG, file=sys.stderr)
            return 2
        password = line
        if not password:
            print("refused: --password-stdin given but stdin was empty", file=sys.stderr)
            return 2
    checker = breach_checker or HibpRangeClient(settings)
    try:
        result = asyncio.run(run(args, settings, password, checker, clock()))
    except RefusedError as refusal:
        print("refused: " + str(refusal), file=sys.stderr)
        return 2
    except RuntimeError as error:
        print("configuration error: " + str(error), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
