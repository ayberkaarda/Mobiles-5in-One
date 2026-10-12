"""Background worker: `uv run arq app.workers.main.WorkerSettings` (spec section 4, arq).

Schedules (docs/ops/background-jobs.md, Europe/Istanbul): photo processing every minute, trace
retention purge and account hard delete hourly, the GeoJSON export every Monday at 03:00.
The jobs reuse the API composition (`build_services`), so they read the same settings and
fail closed the same way: no object store defers photo and export work, no subscriber
deleter defers erasure of subscribers. Every job logs counts only.
"""

from typing import Any, ClassVar
from zoneinfo import ZoneInfo

import structlog
from arq.connections import RedisSettings
from arq.cron import CronJob, cron

from app.core.deps import Services
from app.core.logging import configure_logging
from app.core.settings import load_settings
from app.main import build_services, with_local_defaults
from app.workers.deletion import hard_delete_due
from app.workers.export import export_all_cities
from app.workers.media import process_pending_photos
from app.workers.traces import purge_expired_traces

type Context = dict[str, Any]


def services_of(ctx: Context) -> Services:
    services = ctx["services"]
    if not isinstance(services, Services):
        raise RuntimeError("worker services are not configured")
    return services


async def startup(ctx: Context) -> None:
    settings = with_local_defaults(load_settings())
    configure_logging(settings)
    ctx["services"] = build_services(settings)


async def shutdown(ctx: Context) -> None:
    services = ctx.get("services")
    if isinstance(services, Services):
        await services.redis.aclose()


async def photos_job(ctx: Context) -> int:
    services = services_of(ctx)
    if services.object_store is None:
        structlog.get_logger().warning("worker.photos.deferred_no_store")
        return 0
    count = await process_pending_photos(
        services.session_factory, services.object_store, services.settings, services.clock
    )
    structlog.get_logger().info("worker.photos.processed", count=count)
    return count


async def traces_job(ctx: Context) -> int:
    services = services_of(ctx)
    count = await purge_expired_traces(services.session_factory, services.clock)
    structlog.get_logger().info("worker.traces.purged", count=count)
    return count


async def deletion_job(ctx: Context) -> int:
    services = services_of(ctx)
    summary = await hard_delete_due(
        services.session_factory,
        services.object_store,
        services.settings,
        services.clock,
        services.mail_sender,
        services.subscriber_deleter,
    )
    structlog.get_logger().info(
        "worker.deletion.run", deleted=summary["deleted"], deferred=summary["deferred"]
    )
    return summary["deleted"]


async def export_job(ctx: Context) -> int:
    services = services_of(ctx)
    if services.object_store is None:
        structlog.get_logger().warning("worker.export.deferred_no_store")
        return 0
    exports = await export_all_cities(
        services.session_factory, services.object_store, services.settings, services.clock
    )
    structlog.get_logger().info("worker.export.written", count=len(exports))
    return len(exports)


CRON_JOBS: tuple[CronJob, ...] = (
    cron(photos_job, second=0),
    cron(traces_job, minute=5, second=0),
    cron(deletion_job, minute=20, second=0),
    cron(export_job, weekday="mon", hour=3, minute=0, second=0),
)


def worker_settings() -> type[Any]:
    """The arq settings class; built on first access so importing this module reads no
    environment (arq resolves `app.workers.main.WorkerSettings` through `__getattr__`)."""
    settings = with_local_defaults(load_settings())
    if settings.redis_url is None:
        raise RuntimeError("INECEKVAR_REDIS_URL is required")
    redis = RedisSettings.from_dsn(settings.redis_url.get_secret_value())

    class WorkerSettings:
        functions: ClassVar[list[Any]] = [photos_job, traces_job, deletion_job, export_job]
        cron_jobs: ClassVar[list[CronJob]] = list(CRON_JOBS)
        on_startup = startup
        on_shutdown = shutdown
        redis_settings = redis
        timezone = ZoneInfo("Europe/Istanbul")

    return WorkerSettings


def __getattr__(name: str) -> type[Any]:
    if name != "WorkerSettings":
        raise AttributeError(name)
    return worker_settings()
