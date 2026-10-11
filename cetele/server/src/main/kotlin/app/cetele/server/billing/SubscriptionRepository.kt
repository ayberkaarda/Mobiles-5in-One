package app.cetele.server.billing

import app.cetele.server.tenancy.TenantRepository
import app.cetele.server.tenancy.shop.ShopPlan
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.util.UUID

interface SubscriptionRepository : TenantRepository<Subscription> {
    /** The current row of the shop: at most one, enforced by `subscriptions_one_current_per_shop`. */
    @Query("select s from Subscription s where s.boundShopId = :shopId and s.supersededAt is null")
    fun findCurrent(
        @Param("shopId") shopId: UUID,
    ): Subscription?

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from Subscription s where s.boundShopId = :shopId and s.id = :id")
    fun lockInShop(
        @Param("shopId") shopId: UUID,
        @Param("id") id: UUID,
    ): Subscription?

    /** `shops.plan` is derived: only [EntitlementService] writes it, through this update. */
    @Modifying(flushAutomatically = true)
    @Query("update Shop s set s.plan = :plan where s.id = :shopId and s.deletedAt is null")
    fun writePlan(
        @Param("shopId") shopId: UUID,
        @Param("plan") plan: ShopPlan,
    ): Int
}
