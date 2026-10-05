package app.cetele.server.tenancy.shop

import app.cetele.server.security.CurrentUser
import app.cetele.server.security.ShopRole
import app.cetele.server.tenancy.MembershipResolver
import app.cetele.server.tenancy.TenantContext
import app.cetele.server.tenancy.membership.Membership
import app.cetele.server.tenancy.membership.MembershipRepository
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Instant
import java.util.UUID

/** A shop as the caller sees it, including the caller's own role. */
data class ShopView(
    val id: UUID,
    val name: String,
    val type: ShopType,
    val il: String,
    val ilce: String,
    val plan: ShopPlan,
    val createdAt: Instant,
    val role: ShopRole,
)

data class NewShop(
    val name: String,
    val type: ShopType,
    val il: String,
    val ilce: String,
)

/** Partial update; `null` keeps the current value. The plan is not part of it. */
data class ShopChanges(
    val name: String?,
    val type: ShopType?,
    val il: String?,
    val ilce: String?,
)

@Service
class ShopService(
    private val shops: ShopRepository,
    private val memberships: MembershipRepository,
    private val resolver: MembershipResolver,
    private val clock: Clock,
) {
    /** Creates the shop and makes the caller its only `OWNER`, in one transaction. */
    @Transactional
    fun create(
        caller: CurrentUser,
        input: NewShop,
    ): ShopView {
        val now = clock.instant()
        val shop =
            shops.save(
                Shop(
                    name = input.name.trim(),
                    type = input.type,
                    il = input.il.trim(),
                    ilce = input.ilce.trim(),
                    createdBy = caller.userId,
                    createdAt = now,
                ),
            )
        memberships.save(Membership(shopId = shop.shopId, userId = caller.userId, role = ShopRole.OWNER, createdAt = now))
        return view(shop, ShopRole.OWNER)
    }

    @Transactional(readOnly = true)
    fun get(
        shopId: UUID,
        caller: CurrentUser,
    ): ShopView {
        val tenant = resolver.resolve(shopId, caller)
        return view(load(tenant), tenant.role)
    }

    @Transactional
    fun update(
        shopId: UUID,
        caller: CurrentUser,
        changes: ShopChanges,
    ): ShopView {
        val tenant = resolver.resolve(shopId, caller)
        val shop = load(tenant)
        changes.name?.let { shop.name = it.trim() }
        changes.type?.let { shop.type = it }
        changes.il?.let { shop.il = it.trim() }
        changes.ilce?.let { shop.ilce = it.trim() }
        return view(shops.save(shop), tenant.role)
    }

    private fun load(tenant: TenantContext): Shop =
        shops.findActive(tenant.shopId) ?: throw ProblemException(ProblemCode.NOT_FOUND, "shop not found")

    private fun view(
        shop: Shop,
        role: ShopRole,
    ) = ShopView(
        id = shop.shopId,
        name = shop.name,
        type = shop.type,
        il = shop.il,
        ilce = shop.ilce,
        plan = shop.plan,
        createdAt = shop.createdAt,
        role = role,
    )
}
