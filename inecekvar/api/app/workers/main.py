"""Background worker: `uv run arq app.workers.main.WorkerSettings` (spec section 4, arq).

Schedules (docs/ops/background-jobs.md, Europe/Istanbul): photo processing every minute, trace
retention purge and account hard delete hourly, the GeoJSON export every Monday at 03:00.
Phase 5 (ADR-0050): the pending webhook sweep every five minutes; nightly the RevenueCat
reconciliation (04:10), the expired entitlement sweep (04:40), the retention purge (04:50) and
the pack download roll-up (05:00), each idempotent with a dry-run switch.
Phase 6 (ADR-0053): `backup.verify` daily at 07:30 checks the age and size of the newest dump.
Phase 6 (ADR-0054): `cost.guard` every 15 minutes counts today's mails, pack downloads, presigns,
exports and planner calls against thresholds and sets or clears the planner degrade flag.
The jobs reuse the API composition (`build_services`), so they read the same settings and
fail closed the same way: no object store defers photo and export work, no subscriber
deleter defers erasure of subscribers. Every job logs counts only.
"""

import uuid
from datetime import timedelta
from typing import Any, ClassVar
from zoneinfo import ZoneInfo

import structlog
from arq.connections import RedisSettings
from arq.cron import CronJob, cron

from app.billing.events import pending_revenuecat_events, process_revenuecat_event
from app.billing.reconcile import reconcile_subscriptions
from app.core.deps import Services
from app.core.jobs import ArqJobQueue
from app.core.logging import configure_logging
from app.core.settings import load_settings
from app.main import build_services, with_local_defaults
from app.workers.backup_verify import (
    RESULT_KEY,
    RESULT_TTL_SECONDS,
    BackupVerifySettings,
    lister_from_settings,
    run_backup_verify,
)
from app.workers.cost_guard import CostGuardSettings, DatabaseUsageSource, run_cost_guard
from app.workers.deletion import hard_delete_due
from app.workers.export import export_all_cities
from app.workers.media import process_pending_photos
from app.workers.nightly import (
    purge_retention,
    roll_up_pack_downloads,
    sweep_expired_entitlements,
)
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
        if isinstance(services.job_queue, ArqJobQueue):
            await services.job_queue.close()


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


async def revenuecat_event_job(ctx: Context, row_id: str) -> str | None:
    """Enqueued by `POST /v1/webhooks/revenuecat` for one stored event."""
    services = services_of(ctx)
    outcome = await process_revenuecat_event(
        services.session_factory,
        uuid.UUID(row_id),
        services.settings,
        services.clock,
        services.revenuecat,
    )
    return outcome.value if outcome is not None else None


async def webhooks_pending_job(ctx: Context) -> int:
    """Processes stored events whose enqueue was lost or whose processing failed (retry)."""
    services = services_of(ctx)
    before = services.clock.now() - timedelta(minutes=1)
    count = 0
    for row_id in await pending_revenuecat_events(services.session_factory, before):
        outcome = await process_revenuecat_event(
            services.session_factory,
            row_id,
            services.settings,
            services.clock,
            services.revenuecat,
        )
        count += outcome is not None
    structlog.get_logger().info("worker.webhooks.pending", count=count)
    return count


def dry_run_of(services: Services, dry_run: bool | None) -> bool:
    """An explicit job argument (`enqueue_job(name, dry_run=True)`) wins over the setting."""
    return services.settings.jobs_dry_run if dry_run is None else dry_run


async def reconcile_job(ctx: Context, dry_run: bool | None = None) -> int:
    services = services_of(ctx)
    if services.revenuecat is None:
        structlog.get_logger().warning("worker.reconcile.skipped_no_rest_key")
        return 0
    summary = await reconcile_subscriptions(
        services.session_factory,
        services.revenuecat,
        services.settings,
        services.clock,
        dry_run=dry_run_of(services, dry_run),
    )
    return summary.changed + summary.inserted


async def entitlement_sweep_job(ctx: Context, dry_run: bool | None = None) -> int:
    services = services_of(ctx)
    return await sweep_expired_entitlements(
        services.session_factory, services.clock, dry_run=dry_run_of(services, dry_run)
    )


async def retention_job(ctx: Context, dry_run: bool | None = None) -> int:
    services = services_of(ctx)
    summary = await purge_retention(
        services.session_factory,
        services.settings,
        services.clock,
        dry_run=dry_run_of(services, dry_run),
    )
    return summary.webhook_events + summary.bounce_suppressions


async def pack_rollup_job(ctx: Context, dry_run: bool | None = None) -> int:
    services = services_of(ctx)
    summary = await roll_up_pack_downloads(
        services.session_factory,
        services.settings,
        services.clock,
        dry_run=dry_run_of(services, dry_run),
    )
    return summary.rows_deleted


async def backup_verify_job(ctx: Context, dry_run: bool | None = None) -> dict[str, object]:
    """`backup.verify`: alert when the newest dump is missing, stale, empty or too small."""
    services = services_of(ctx)
    config = BackupVerifySettings()

    async def publish(payload: str) -> None:
        await services.redis.set(RESULT_KEY, payload, ex=RESULT_TTL_SECONDS)

    result = await run_backup_verify(
        lister_from_settings(config, services.settings),
        config,
        services.clock.now(),
        publish,
        dry_run=dry_run_of(services, dry_run),
        require_configured=services.settings.env == "production",
    )
    return result.as_dict()


async def cost_guard_job(ctx: Context, dry_run: bool | None = None) -> dict[str, object]:
    """`cost.guard`: daily usage against thresholds and the planner degrade flag."""
    services = services_of(ctx)
    result = await run_cost_guard(
        DatabaseUsageSource(services.session_factory),
        services.redis,
        CostGuardSettings(),
        services.clock.now(),
        dry_run=dry_run_of(services, dry_run),
    )
    return result.as_dict()


CRON_JOBS: tuple[CronJob, ...] = (
    cron(photos_job, second=0),
    cron(traces_job, minute=5, second=0),
    cron(deletion_job, minute=20, second=0),
    cron(export_job, weekday="mon", hour=3, minute=0, second=0),
    cron(webhooks_pending_job, minute=set(range(0, 60, 5)), second=30),
    cron(reconcile_job, hour=4, minute=10, second=0),
    cron(entitlement_sweep_job, hour=4, minute=40, second=0),
    cron(retention_job, hour=4, minute=50, second=0),
    cron(pack_rollup_job, hour=5, minute=0, second=0),
    cron(backup_verify_job, hour=7, minute=30, second=0),
    cron(cost_guard_job, minute={7, 22, 37, 52}, second=0),
)


def worker_settings() -> type[Any]:
    """The arq settings class; built on first access so importing this module reads no
    environment (arq resolves `app.workers.main.WorkerSettings` through `__getattr__`)."""
    settings = with_local_defaults(load_settings())
    if settings.redis_url is None:
        raise RuntimeError("INECEKVAR_REDIS_URL is required")
    redis = RedisSettings.from_dsn(settings.redis_url.get_secret_value())

    class WorkerSettings:
        functions: ClassVar[list[Any]] = [
            photos_job,
            traces_job,
            deletion_job,
            export_job,
            revenuecat_event_job,
            webhooks_pending_job,
            reconcile_job,
            entitlement_sweep_job,
            retention_job,
            pack_rollup_job,
            backup_verify_job,
            cost_guard_job,
        ]
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
