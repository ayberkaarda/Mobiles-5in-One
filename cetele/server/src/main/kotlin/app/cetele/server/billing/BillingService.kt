package app.cetele.server.billing

import app.cetele.server.billing.play.PlayDeveloperApi
import app.cetele.server.billing.play.PlaySubscriptionPurchase
import app.cetele.server.billing.play.PlaySubscriptionResult
import app.cetele.server.config.CeteleTime
import app.cetele.server.ledger.customer.CustomerRepository
import app.cetele.server.media.MediaObjectRepository
import app.cetele.server.tenancy.shop.ShopRepository
import app.cetele.server.web.problem.FieldErrorCodes
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import app.cetele.server.web.problem.ProblemFieldError
import jakarta.persistence.PersistenceException
import org.slf4j.LoggerFactory
import org.springframework.dao.DataAccessException
import org.springframework.http.HttpHeaders
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.util.UUID

/**
 * `GET billing` and `POST billing/link` (ADR-0031). The plan only becomes `PRO` through a token
 * Play confirms and that is bound to the path shop; the request body alone never changes it.
 * Log lines carry the shop, the outcome and the state, never the token or its hash.
 */
@Service
class BillingService(
    private val shops: ShopRepository,
    private val subscriptions: SubscriptionRepository,
    private val index: SubscriptionIndex,
    private val customers: CustomerRepository,
    private val media: MediaObjectRepository,
    private val writer: SubscriptionWriter,
    private val play: PlayDeveloperApi,
    private val settings: BillingSettings,
    transactionManager: PlatformTransactionManager,
) {
    private val readTx = TransactionTemplate(transactionManager).apply { isReadOnly = true }
    private val log = LoggerFactory.getLogger(BillingService::class.java)

    fun state(
        shopId: UUID,
        now: Instant,
    ): BillingState =
        checkNotNull(
            readTx.execute {
                val shop = shops.findActive(shopId) ?: throw ProblemException(ProblemCode.NOT_FOUND, "shop not found")
                val month = SubscriptionIndex.month(now)
                val monthStart =
                    month
                        .atDay(1)
                        .atStartOfDay(CeteleTime.ZONE)
                        .toInstant()
                val usage =
                    PlanUsageView(
                        month = month.toString(),
                        customers = customers.countLive(shopId).toIntSaturated(),
                        photos = media.countReserved(shopId, monthStart).toIntSaturated(),
                        sms = index.smsUsed(shopId, month),
                    )
                BillingState(
                    plan = shop.plan,
                    limits = PlanLimitsView.of(shop.plan),
                    usage = usage,
                    subscription = subscriptions.findCurrent(shopId)?.let { SubscriptionView.of(it, now) },
                )
            },
        )

    fun link(
        shopId: UUID,
        userId: UUID,
        productId: String,
        token: String,
        now: Instant,
    ): BillingState {
        if (productId != settings.productId) {
            throw ProblemException(
                ProblemCode.VALIDATION_FAILED,
                "product is not the configured product",
                listOf(ProblemFieldError("productId", FieldErrorCodes.OUT_OF_RANGE)),
            )
        }
        val hash = PurchaseTokens.hash(token)
        index.byTokenHash(hash)?.let { return relink(shopId, it, token, now) }
        val purchase =
            when (val result = play.getSubscription(token)) {
                is PlaySubscriptionResult.Found -> result.purchase
                PlaySubscriptionResult.NotFound -> refuse(shopId, ProblemCode.BILLING_PURCHASE_INVALID, "not_found")
                is PlaySubscriptionResult.Unavailable -> unavailable(shopId, result.reason)
            }
        val state =
            when (val check = PurchaseCheck.of(purchase, shopId, settings.productId)) {
                is PurchaseCheck.Valid -> check.state
                is PurchaseCheck.Refused -> refuse(shopId, check.code, check.reason)
            }
        val result =
            try {
                writer.insert(shopId, token, purchase, state, userId, now, PlanChangeReason.LINK, replacementOnly = false)
            } catch (failure: ProblemException) {
                refuse(shopId, failure.code, failure.detail ?: "refused", failure)
            } catch (failure: DataAccessException) {
                InsertResult.Existing(index.byTokenHash(hash) ?: throw failure)
            } catch (failure: PersistenceException) {
                InsertResult.Existing(index.byTokenHash(hash) ?: throw failure)
            }
        return when (result) {
            is InsertResult.Existing -> {
                relink(shopId, result.ref, token, now)
            }

            is InsertResult.Inserted -> {
                val outcome = if (result.replaced) "replaced" else "linked"
                log.info("Billing link shop={} outcome={} state={}", shopId, outcome, state)
                acknowledge(result.key, purchase, token, now)
                state(shopId, now)
            }

            InsertResult.NotAReplacement -> {
                error("link inserts without the replacement-only rule")
            }
        }
    }

    /** A token already stored: re-verify it when it is this shop's, refuse it otherwise (link step 3). */
    private fun relink(
        shopId: UUID,
        ref: SubscriptionRef,
        token: String,
        now: Instant,
    ): BillingState {
        val rowShop = ref.shopId
        if (rowShop != shopId || ref.state == SubscriptionState.ORPHANED) {
            refuse(shopId, ProblemCode.BILLING_TOKEN_IN_USE, "stored_for_other_shop")
        }
        val key = SubscriptionKey(shopId, ref.id)
        val purchase =
            when (val result = play.getSubscription(token)) {
                is PlaySubscriptionResult.Found -> result.purchase
                PlaySubscriptionResult.NotFound -> null
                is PlaySubscriptionResult.Unavailable -> unavailable(shopId, result.reason)
            }
        val state = writer.refresh(key, purchase, now, PlanChangeReason.LINK) ?: throw ProblemException(ProblemCode.NOT_FOUND, "shop gone")
        log.info("Billing link shop={} outcome=refreshed state={}", shopId, state)
        if (purchase != null) acknowledge(key, purchase, token, now)
        return state(shopId, now)
    }

    private fun acknowledge(
        key: SubscriptionKey,
        purchase: PlaySubscriptionPurchase,
        token: String,
        now: Instant,
    ) {
        if (purchase.acknowledgementPending) writer.acknowledgeIfDue(key, token, now)
    }

    private fun refuse(
        shopId: UUID,
        code: ProblemCode,
        reason: String,
        cause: ProblemException? = null,
    ): Nothing {
        log.info("Billing link shop={} outcome=refused code={} reason={}", shopId, code.code, reason)
        throw cause ?: ProblemException(code, reason)
    }

    private fun unavailable(
        shopId: UUID,
        reason: String,
    ): Nothing {
        log.warn("Billing link shop={} outcome=unavailable reason={}", shopId, reason)
        throw ProblemException(
            ProblemCode.BILLING_UNAVAILABLE,
            "play unavailable",
            headers = mapOf(HttpHeaders.RETRY_AFTER to RETRY_AFTER_SECONDS.toString()),
        )
    }

    private fun Long.toIntSaturated(): Int = coerceAtMost(Int.MAX_VALUE.toLong()).toInt()

    companion object {
        const val RETRY_AFTER_SECONDS = 30
    }
}
