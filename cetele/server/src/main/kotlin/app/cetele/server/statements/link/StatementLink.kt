package app.cetele.server.statements.link

import app.cetele.server.tenancy.TenantScoped
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.UuidGenerator
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "statement_links")
class StatementLink(
    @Column(name = "shop_id", nullable = false, updatable = false)
    override val shopId: UUID,
    @Column(name = "customer_id", nullable = false, updatable = false)
    val customerId: UUID,
    @Column(name = "token_hash", nullable = false, updatable = false)
    val tokenHash: String,
    @Column(name = "expires_at", nullable = false, updatable = false)
    val expiresAt: Instant,
    @Column(name = "created_by", updatable = false)
    val createdBy: UUID?,
    @Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant,
) : TenantScoped {
    @Id
    @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    var id: UUID? = null

    @Column(name = "opened_at")
    var openedAt: Instant? = null

    @Column(name = "open_count", nullable = false)
    var openCount: Int = 0

    @Column(name = "revoked_at")
    var revokedAt: Instant? = null
}
