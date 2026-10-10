package app.cetele.server.billing

import app.cetele.server.config.CeteleTime
import jakarta.persistence.EntityManager
import org.springframework.stereotype.Component
import java.time.Instant
import java.time.YearMonth
import java.util.UUID

/** Where a token hash points: its row, its shop (`null` once the shop is gone) and its state. */
data class SubscriptionRef(
    val id: UUID,
    val shopId: UUID?,
    val state: SubscriptionState,
    val supersededAt: Instant?,
) {
    val current: Boolean get() = supersededAt == null && shopId != null
}

/** A row the sweep looks at, named by its shop so the tenant repository can lock it. */
data class SubscriptionKey(
    val shopId: UUID,
    val id: UUID,
)

/**
 * Lookups that start from a token hash or span every shop (ADR-0031). Only ids and shop ids leave
 * this class; rows are then read through [SubscriptionRepository] with their shop id, as
 * `StatementLinkIndex` does for statement links.
 */
@Component
class SubscriptionIndex(
    private val entityManager: EntityManager,
) {
    fun byTokenHash(hash: String): SubscriptionRef? =
        entityManager
            .createQuery(
                "select new app.cetele.server.billing.SubscriptionRef(s.id, s.boundShopId, s.state, s.supersededAt) " +
                    "from Subscription s where s.purchaseTokenHash = :hash",
                SubscriptionRef::class.java,
            ).setParameter("hash", hash)
            .setMaxResults(1)
            .resultList
            .firstOrNull()

    /**
     * Current rows to ask Play about again: entitling states whose paid period has ended, and any
     * row of a non-sticky state not verified since [staleBefore].
     */
    fun reverifyCandidates(
        now: Instant,
        staleBefore: Instant,
        limit: Int,
    ): List<SubscriptionKey> =
        entityManager
            .createQuery(
                "select new app.cetele.server.billing.SubscriptionKey(s.boundShopId, s.id) from Subscription s " +
                    "where s.supersededAt is null and s.boundShopId is not null and (" +
                    "(s.state in :expiring and s.expiresAt < :now) or " +
                    "(s.state not in :sticky and s.lastVerifiedAt < :staleBefore)) order by s.lastVerifiedAt",
                SubscriptionKey::class.java,
            ).setParameter("expiring", EXPIRING)
            .setParameter("sticky", STICKY)
            .setParameter("now", now)
            .setParameter("staleBefore", staleBefore)
            .setMaxResults(limit)
            .resultList

    /** Current entitling rows whose purchase was never acknowledged (Play refunds after three days). */
    fun unacknowledged(limit: Int): List<SubscriptionKey> =
        entityManager
            .createQuery(
                "select new app.cetele.server.billing.SubscriptionKey(s.boundShopId, s.id) from Subscription s " +
                    "where s.supersededAt is null and s.boundShopId is not null and s.acknowledgedAt is null and s.state in :states",
                SubscriptionKey::class.java,
            ).setParameter("states", ACKNOWLEDGEABLE)
            .setMaxResults(limit)
            .resultList

    /** Rows whose shop was deleted become `ORPHANED` and lose their encrypted token; the hash stays. */
    fun orphanDetached(now: Instant): Int =
        entityManager
            .createQuery(
                "update Subscription s set s.state = :orphaned, s.purchaseTokenEnc = null, s.updatedAt = :now " +
                    "where s.boundShopId is null and (s.state <> :orphaned or s.purchaseTokenEnc is not null)",
            ).setParameter("orphaned", SubscriptionState.ORPHANED)
            .setParameter("now", now)
            .executeUpdate()

    /** This month's SMS quota use of the shop, the number `sms.quota_exceeded` is checked against. */
    fun smsUsed(
        shopId: UUID,
        month: YearMonth,
    ): Int =
        entityManager
            .createQuery("select q.used from SmsQuota q where q.shopId = :shopId and q.month = :month", Int::class.javaObjectType)
            .setParameter("shopId", shopId)
            .setParameter("month", month.atDay(1))
            .resultList
            .firstOrNull() ?: 0

    /** Writes pending changes now, so the partial unique index sees a superseded row before its successor. */
    fun flush() = entityManager.flush()

    companion object {
        val EXPIRING = listOf(SubscriptionState.ACTIVE, SubscriptionState.IN_GRACE_PERIOD, SubscriptionState.CANCELED)
        val ACKNOWLEDGEABLE = listOf(SubscriptionState.ACTIVE, SubscriptionState.IN_GRACE_PERIOD)
        val STICKY = SubscriptionState.entries.filter { it.sticky }

        fun month(now: Instant): YearMonth = YearMonth.from(now.atZone(CeteleTime.ZONE))
    }
}
