package app.cetele.server.billing.webhook

import app.cetele.server.billing.BillingSettings
import app.cetele.server.billing.InsertResult
import app.cetele.server.billing.PlanChangeReason
import app.cetele.server.billing.PurchaseCheck
import app.cetele.server.billing.PurchaseTokenCipher
import app.cetele.server.billing.PurchaseTokens
import app.cetele.server.billing.SubscriptionIndex
import app.cetele.server.billing.SubscriptionKey
import app.cetele.server.billing.SubscriptionState
import app.cetele.server.billing.SubscriptionWriter
import app.cetele.server.billing.play.PlayDeveloperApi
import app.cetele.server.billing.play.PlaySubscriptionPurchase
import app.cetele.server.billing.play.PlaySubscriptionResult
import app.cetele.server.config.JobLocks
import app.cetele.server.web.problem.ProblemException
import jakarta.annotation.PreDestroy
import jakarta.persistence.PersistenceException
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.dao.DataAccessException
import org.springframework.data.domain.PageRequest
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** How one stored notification ended; `null` status means "retry later". */
private data class Outcome(
    val status: WebhookEventStatus?,
    val label: String,
)

/**
 * Processes stored RTDN rows (ADR-0031 "Notification processing"): right after a delivery is
 * stored and every 30 seconds, under the `billing.rtdn` job lock and behind `CETELE_JOBS_ENABLED`.
 * Every known token is read again from Play. Type 12 and voided purchases revoke only when Play
 * confirms expiry or no longer knows the token. Play failures
 * are retried after 1, 5, 15, 60 and 360 minutes, then the row is `FAILED`.
 */
@Component
class RtdnProcessor(
    private val events: WebhookEventRepository,
    private val index: SubscriptionIndex,
    private val writer: SubscriptionWriter,
    private val play: PlayDeveloperApi,
    private val cipher: PurchaseTokenCipher,
    private val settings: BillingSettings,
    private val jobs: JobLocks,
    private val clock: Clock,
    @param:Value("\${cetele.jobs.enabled:true}") private val jobsEnabled: Boolean,
    transactionManager: PlatformTransactionManager,
) {
    private val log = LoggerFactory.getLogger(RtdnProcessor::class.java)
    private val tx =
        TransactionTemplate(transactionManager).apply {
            propagationBehavior = TransactionDefinition.PROPAGATION_REQUIRES_NEW
        }
    private val executor: ExecutorService =
        Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "billing-rtdn").apply { isDaemon = true } }
    private val queued = AtomicBoolean(false)

    @Scheduled(fixedDelay = 30_000, initialDelay = 30_000)
    fun scheduledRun() {
        processDue(clock.instant())
    }

    /** Starts a run after the response, coalescing bursts; does nothing while jobs are switched off. */
    fun triggerSoon() {
        if (!jobsEnabled || !queued.compareAndSet(false, true)) return
        executor.execute {
            queued.set(false)
            try {
                processDue(clock.instant())
            } catch (failure: RuntimeException) {
                log.warn("Rtdn processing outcome=run_failed error={}", failure.javaClass.simpleName)
            }
        }
    }

    @PreDestroy
    fun stop() {
        executor.shutdownNow()
    }

    /** Processes every due row; returns how many rows were looked at (0 when another run holds the lock). */
    fun processDue(now: Instant): Int {
        var count = 0
        jobs.runExclusive(JOB_LOCK) {
            events.due(now, PageRequest.of(0, BATCH)).forEach { id ->
                process(id, now)
                count++
            }
        }
        return count
    }

    private fun process(
        id: UUID,
        now: Instant,
    ) {
        val event = tx.execute { events.find(id) }?.takeIf { it.status == WebhookEventStatus.RECEIVED } ?: return
        val outcome =
            try {
                decide(event, now)
            } catch (failure: ProblemException) {
                Outcome(WebhookEventStatus.IGNORED, failure.code.code.replace('.', '_'))
            }
        tx.executeWithoutResult {
            val row = events.find(id) ?: return@executeWithoutResult
            if (row.status != WebhookEventStatus.RECEIVED) return@executeWithoutResult
            val status = outcome.status
            if (status != null) {
                row.finish(status, outcome.label, now)
            } else {
                row.attempts += 1
                val delay = RETRY_DELAYS.getOrNull(row.attempts - 1)
                if (delay == null) {
                    row.finish(WebhookEventStatus.FAILED, outcome.label, now)
                    log.warn("Rtdn processing outcome=failed attempts={}", row.attempts)
                } else {
                    row.outcome = outcome.label
                    row.nextAttemptAt = now.plus(delay)
                }
            }
        }
        log.info("Rtdn processing outcome={} type={}", outcome.label, event.notificationType)
    }

    private fun decide(
        event: WebhookEvent,
        now: Instant,
    ): Outcome {
        val token = cipher.decrypt(event.purchaseTokenEnc) ?: return Outcome(WebhookEventStatus.FAILED, "token_unreadable")
        val hash = PurchaseTokens.hash(token)
        val ref = index.byTokenHash(hash)
        val type = event.notificationType
        if (ref != null) {
            val shopId = ref.shopId ?: return Outcome(WebhookEventStatus.IGNORED, "orphaned")
            val key = SubscriptionKey(shopId, ref.id)
            val revocation = type == null || type == RtdnEnvelope.SUBSCRIPTION_REVOKED
            val readAt = clock.instant()
            return when (val result = play.getSubscription(token)) {
                is PlaySubscriptionResult.Found -> {
                    if (revocation && result.purchase.subscriptionState == PlaySubscriptionPurchase.STATE_EXPIRED) {
                        return confirmedRevocation(key, now, type, readAt)
                    }
                    writer.refresh(key, result.purchase, now, PlanChangeReason.RTDN, type, readAt)
                    if (result.purchase.acknowledgementPending) writer.acknowledgeIfDue(key, token, now)
                    Outcome(WebhookEventStatus.PROCESSED, if (revocation) "revoke_unconfirmed" else "verified")
                }

                PlaySubscriptionResult.NotFound -> {
                    if (revocation) return confirmedRevocation(key, now, type, readAt)
                    writer.refresh(key, null, now, PlanChangeReason.RTDN, type, readAt)
                    Outcome(WebhookEventStatus.PROCESSED, "not_found")
                }

                is PlaySubscriptionResult.Unavailable -> {
                    Outcome(null, "unavailable")
                }
            }
        }
        if (type == null || type == RtdnEnvelope.SUBSCRIPTION_REVOKED) return Outcome(WebhookEventStatus.IGNORED, "unknown_token")
        return replacement(token, now)
    }

    private fun confirmedRevocation(
        key: SubscriptionKey,
        now: Instant,
        type: Int?,
        readAt: Instant,
    ): Outcome =
        if (writer.revoke(key, now, PlanChangeReason.RTDN, type, readAt)) {
            Outcome(WebhookEventStatus.PROCESSED, "revoked")
        } else {
            Outcome(WebhookEventStatus.IGNORED, "not_applied")
        }

    /** An unknown token can only replace the current row its `linkedPurchaseToken` names; the owner's link verifies the rest. */
    private fun replacement(
        token: String,
        now: Instant,
    ): Outcome {
        val readAt = clock.instant()
        val purchase =
            when (val result = play.getSubscription(token)) {
                is PlaySubscriptionResult.Found -> result.purchase
                PlaySubscriptionResult.NotFound -> return Outcome(WebhookEventStatus.IGNORED, "unknown_token")
                is PlaySubscriptionResult.Unavailable -> return Outcome(null, "unavailable")
            }
        val linked = purchase.linkedPurchaseToken ?: return Outcome(WebhookEventStatus.IGNORED, "unknown_token")
        val previous = index.byTokenHash(PurchaseTokens.hash(linked))
        val shopId = previous?.takeIf { it.current }?.shopId ?: return Outcome(WebhookEventStatus.IGNORED, "unknown_token")
        val state =
            when (val check = PurchaseCheck.of(purchase, shopId, settings.productId)) {
                is PurchaseCheck.Valid -> check.state
                is PurchaseCheck.Refused -> return Outcome(WebhookEventStatus.IGNORED, "unknown_token")
            }
        val result =
            try {
                writer.insert(shopId, token, purchase, state, null, now, PlanChangeReason.RTDN, replacementOnly = true, readAt = readAt)
            } catch (_: DataAccessException) {
                return Outcome(WebhookEventStatus.PROCESSED, "already_linked")
            } catch (_: PersistenceException) {
                return Outcome(WebhookEventStatus.PROCESSED, "already_linked")
            }
        return when (result) {
            is InsertResult.Inserted -> {
                if (purchase.acknowledgementPending && state in ACKNOWLEDGEABLE) writer.acknowledgeIfDue(result.key, token, now)
                Outcome(WebhookEventStatus.PROCESSED, "replaced")
            }

            is InsertResult.Existing -> {
                Outcome(WebhookEventStatus.PROCESSED, "already_linked")
            }

            InsertResult.NotAReplacement -> {
                Outcome(WebhookEventStatus.IGNORED, "unknown_token")
            }
        }
    }

    companion object {
        const val JOB_LOCK = "billing.rtdn"
        private const val BATCH = 100
        private val ACKNOWLEDGEABLE = setOf(SubscriptionState.ACTIVE, SubscriptionState.IN_GRACE_PERIOD)
        val RETRY_DELAYS: List<Duration> =
            listOf(Duration.ofMinutes(1), Duration.ofMinutes(5), Duration.ofMinutes(15), Duration.ofMinutes(60), Duration.ofMinutes(360))
    }
}
