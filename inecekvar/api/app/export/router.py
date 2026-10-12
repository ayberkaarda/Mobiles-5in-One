import hashlib
import hmac
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Header
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select

from app.cities.router import get_city, published_lastmod
from app.core.deps import (
    ClientIpDep,
    ClockDep,
    DbDep,
    ObjectStoreDep,
    OptionalPrincipalDep,
    RateLimiterDep,
    ServicesDep,
    SettingsDep,
    enforce_rate_limit,
)
from app.core.errors import ProblemError
from app.core.storage import ObjectMissingError, ObjectTooLargeError
from app.export.dataset import city_dataset
from app.models.billing import PackDownload
from app.models.geo import City, Line, LineStop, LineVersion, Stop
from app.models.ops import Export

router = APIRouter()
MAX_EXPORT_BYTES = 50 * 1024 * 1024


PACK_REQUEST_HEADER = "X-Pack-Request"


class SitemapCityOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slug: str
    lastmod: datetime
    is_sample: bool
    published_line_count: int


class SitemapIndexOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cities: list[SitemapCityOut]


@router.get("/sitemap")
async def sitemap_index(db: DbDep) -> SitemapIndexOut:
    rows = await db.execute(
        select(City, func.count(Line.id))
        .join(Line, Line.city_id == City.id)
        .join(LineVersion, Line.current_version_id == LineVersion.id)
        .where(Line.status == "published")
        .group_by(City.id)
        .order_by(City.slug)
    )
    cities = list(rows.all())
    lastmods = await published_lastmod(db, [city.id for city, _ in cities])
    return SitemapIndexOut(
        cities=[
            SitemapCityOut(
                slug=city.slug,
                lastmod=lastmods[city.id],
                is_sample=city.is_sample,
                published_line_count=count,
            )
            for city, count in cities
            if city.id in lastmods
        ]
    )


def pack_lock(identity: str) -> int:
    return int.from_bytes(hashlib.sha256(identity.encode()).digest()[:8], signed=True)


@router.get("/cities/{slug}/pack")
async def download_pack(
    slug: str,
    db: DbDep,
    principal: OptionalPrincipalDep,
    client_ip: ClientIpDep,
    settings: SettingsDep,
    clock: ClockDep,
    limiter: RateLimiterDep,
    services: ServicesDep,
    pack_request: Annotated[str, Header(alias=PACK_REQUEST_HEADER)],
) -> dict[str, object]:
    # Downloading can select the free first city, so it must not be triggered by a
    # cross-site navigation or image: browsers send this custom header only from code on an
    # allowed origin (after a CORS preflight), never on a plain link.
    if pack_request != "1":
        raise ProblemError("pack.header_required", 400)
    # The network identity always counts against the daily quota, also for a signed-in caller,
    # so signing in or out does not reset it.
    anon_hash = hmac.new(
        settings.require_secret("log_hash_key"),
        b"pack-anon:" + client_ip.encode(),
        hashlib.sha256,
    ).digest()
    identities = ["anon:" + anon_hash.hex()]
    if principal is not None:
        identities.insert(0, "user:" + str(principal.user_id))
    for identity in identities:
        await enforce_rate_limit(limiter, "pack.download", identity)
    # Transaction locks serialize first-city selection and daily recording per identity
    # (always user before network identity, so two requests cannot deadlock).
    for identity in identities:
        await db.execute(select(func.pg_advisory_xact_lock(pack_lock(identity))))
    city = await get_city(db, slug)
    # The account's own history decides for a signed-in caller (a shared network must not take
    # away an account's free city); the network identity still counts against the quota.
    predicate = (
        PackDownload.user_id == principal.user_id
        if principal is not None
        else PackDownload.anon_hash == anon_hash
    )
    first_city = await db.scalar(
        select(PackDownload.city_id)
        .where(predicate)
        .order_by(PackDownload.created_at, PackDownload.id)
        .limit(1)
    )
    now = clock.now().astimezone(UTC)
    if first_city is not None and first_city != city.id:
        plus = (
            principal is not None
            and services.entitlements is not None
            and await services.entitlements.has_plus(db, principal.user_id, now)
        )
        if not plus:
            raise ProblemError("pack.entitlement_required", 403)
    recorded = await db.scalar(
        select(PackDownload.id).where(
            predicate, PackDownload.city_id == city.id, PackDownload.day == now.date()
        )
    )
    if recorded is None:
        db.add(
            PackDownload(
                user_id=principal.user_id if principal is not None else None,
                # A signed-in download is recorded under the account only.
                anon_hash=anon_hash if principal is None else None,
                city_id=city.id,
                day=now.date(),
                created_at=now,
                updated_at=now,
            )
        )
    dataset = await city_dataset(db, city)
    await db.commit()
    return dataset


@router.get("/cities/{slug}/tiles.pmtiles")
async def tiles(slug: str, db: DbDep, settings: SettingsDep) -> RedirectResponse:
    city = await get_city(db, slug)
    if settings.pmtiles_base_url is None:
        raise ProblemError("tiles.not_configured", 404)
    return RedirectResponse(settings.pmtiles_base_url + "/" + city.slug + ".pmtiles", 302)


@router.get("/export/{city}/latest.geojson")
async def latest_geojson(
    city: str, db: DbDep, store: ObjectStoreDep, settings: SettingsDep
) -> Response:
    stored_city = await get_city(db, city)
    export = await db.scalar(
        select(Export)
        .where(Export.city_id == stored_city.id)
        .order_by(Export.version.desc())
        .limit(1)
    )
    if export is None:
        raise ProblemError("export.not_found", 404)
    try:
        data = await store.get(settings.exports_bucket, export.path, MAX_EXPORT_BYTES)
    except ObjectMissingError as error:
        raise ProblemError("export.not_found", 404) from error
    except ObjectTooLargeError as error:
        raise ProblemError("export.too_large", 503) from error
    return Response(data, media_type="application/geo+json")


@router.get("/cities/{slug}/sitemap")
async def sitemap(slug: str, db: DbDep) -> dict[str, object]:
    city = await get_city(db, slug)
    result = await db.execute(
        select(Line.slug, LineVersion.published_at)
        .join(LineVersion, Line.current_version_id == LineVersion.id)
        .where(Line.city_id == city.id, Line.status == "published")
        .order_by(Line.slug)
    )
    versions = list(result.all())
    stop_dates: dict[str, datetime] = {}
    rows = await db.execute(
        select(Stop, func.max(LineVersion.published_at))
        .outerjoin(LineStop, LineStop.stop_id == Stop.id)
        .outerjoin(
            LineVersion,
            (LineVersion.id == LineStop.line_version_id)
            & LineVersion.id.in_(
                select(Line.current_version_id).where(
                    Line.city_id == city.id, Line.status == "published"
                )
            ),
        )
        .where(Stop.city_id == city.id, Stop.status == "active")
        .group_by(Stop.id)
        .order_by(Stop.slug)
    )
    for stop, published_at in rows:
        stop_dates[stop.slug] = published_at or stop.updated_at
    dates = [row.published_at for row in versions] + list(stop_dates.values())
    return {
        "city": city.slug,
        "lastmod": max(dates, default=city.updated_at).isoformat(),
        "lines": [{"slug": row.slug, "lastmod": row.published_at.isoformat()} for row in versions],
        "stops": [
            {"slug": stop_slug, "lastmod": date.isoformat()}
            for stop_slug, date in stop_dates.items()
        ],
    }
