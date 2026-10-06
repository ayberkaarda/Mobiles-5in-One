package app.cetele.server.tenancy.shop

import app.cetele.server.tenancy.TenantScoped
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.Transient
import org.hibernate.annotations.UuidGenerator
import java.time.Instant
import java.util.UUID

/** Kind of shop, chosen at registration. Stored by name (`shops_type_check`). */
enum class ShopType {
    BAKKAL,
    MANAV,
    KASAP,
    BERBER,
    KAHVEHANE,
    DIGER,
}

/** Subscription plan. Never written by clients; it follows the Play subscription (Phase 4). */
enum class ShopPlan {
    FREE,
    PRO,
}

/** A shop is its own tenant: its [shopId] is its [id]. */
@Entity
@Table(name = "shops")
class Shop(
    @Column(name = "name", nullable = false)
    var name: String,
    @Enumerated(EnumType.STRING)
    @Column(name = "type", nullable = false)
    var type: ShopType,
    @Column(name = "il", nullable = false)
    var il: String,
    @Column(name = "ilce", nullable = false)
    var ilce: String,
    @Column(name = "created_by", nullable = false, updatable = false)
    val createdBy: UUID,
    @Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant,
) : TenantScoped {
    @Id
    @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    @Column(name = "id", nullable = false, updatable = false)
    var id: UUID? = null
        protected set

    @Enumerated(EnumType.STRING)
    @Column(name = "plan", nullable = false)
    var plan: ShopPlan = ShopPlan.FREE
        protected set

    @Column(name = "deleted_at")
    var deletedAt: Instant? = null
        protected set

    @get:Transient
    override val shopId: UUID
        get() = checkNotNull(id) { "shop is not saved yet" }
}
