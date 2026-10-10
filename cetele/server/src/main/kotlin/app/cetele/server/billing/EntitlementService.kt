package app.cetele.server.billing

import app.cetele.server.tenancy.shop.Shop
import app.cetele.server.tenancy.shop.ShopPlan
import app.cetele.server.tenancy.shop.ShopRepository
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.util.UUID

/** Why the plan of a shop was recomputed; logged as `reason=`. */
enum class PlanChangeReason {
    LINK,
    RTDN,
    SWEEP,
    ;

    val label: String get() = name.lowercase()
}

/**
 * Derives `shops.plan` from the current subscription row: `PRO` when it entitles at that instant,
 * else `FREE`. The `shops` row read with `PESSIMISTIC_WRITE` is the billing lock of a shop; every
 * change of a subscription row and the recomputation happen under it.
 */
@Service
class EntitlementService(
    private val shops: ShopRepository,
    private val subscriptions: SubscriptionRepository,
) {
    private val log = LoggerFactory.getLogger(EntitlementService::class.java)

    /** Takes the billing lock of a live shop for the rest of the caller's transaction; `null` when the shop is gone. */
    @Transactional
    fun lock(shopId: UUID): Shop? = shops.lockActive(shopId)

    /** Locks the shop and recomputes its plan; `null` when the shop is gone. */
    @Transactional
    fun recompute(
        shopId: UUID,
        now: Instant,
        reason: PlanChangeReason,
    ): ShopPlan? {
        val shop = lock(shopId) ?: return null
        return recompute(shop, now, reason)
    }

    /** Recomputes the plan of [shop], which the caller has locked with [lock] in this transaction. */
    @Transactional
    fun recompute(
        shop: Shop,
        now: Instant,
        reason: PlanChangeReason,
    ): ShopPlan {
        val current = subscriptions.findCurrent(shop.shopId)
        val plan = if (current != null && current.entitles(now)) ShopPlan.PRO else ShopPlan.FREE
        if (plan != shop.plan) {
            subscriptions.writePlan(shop.shopId, plan)
            log.info("plan changed shop={} from={} to={} reason={}", shop.shopId, shop.plan, plan, reason.label)
        }
        return plan
    }
}
