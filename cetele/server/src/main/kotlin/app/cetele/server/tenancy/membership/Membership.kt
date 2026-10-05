package app.cetele.server.tenancy.membership

import app.cetele.server.security.ShopRole
import app.cetele.server.tenancy.TenantScoped
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.UuidGenerator
import java.time.Instant
import java.util.UUID

/** A user's role in one shop. One row per (shop, user); exactly one `OWNER` per shop. */
@Entity
@Table(name = "memberships")
class Membership(
    @Column(name = "shop_id", nullable = false, updatable = false)
    override val shopId: UUID,
    @Column(name = "user_id", nullable = false, updatable = false)
    val userId: UUID,
    @Enumerated(EnumType.STRING)
    @Column(name = "role", nullable = false, updatable = false)
    val role: ShopRole,
    @Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant,
) : TenantScoped {
    @Id
    @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    @Column(name = "id", nullable = false, updatable = false)
    var id: UUID? = null
        protected set
}
