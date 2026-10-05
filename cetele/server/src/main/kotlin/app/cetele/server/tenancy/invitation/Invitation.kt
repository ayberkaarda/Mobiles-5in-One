package app.cetele.server.tenancy.invitation

import app.cetele.server.tenancy.TenantScoped
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.UuidGenerator
import java.time.Instant
import java.util.UUID

/** A phone-bound invitation to join a shop as `STAFF`. Only the code's SHA-256 is stored. */
@Entity
@Table(name = "invitations")
class Invitation(
    @Column(name = "shop_id", nullable = false, updatable = false)
    override val shopId: UUID,
    @Column(name = "phone_e164", nullable = false, updatable = false)
    val phoneE164: String,
    @Column(name = "code_hash", nullable = false, updatable = false)
    val codeHash: String,
    @Column(name = "expires_at", nullable = false, updatable = false)
    val expiresAt: Instant,
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

    @Column(name = "accepted_at")
    var acceptedAt: Instant? = null
        protected set

    fun isOpen(now: Instant): Boolean = acceptedAt == null && expiresAt.isAfter(now)

    fun accept(now: Instant) {
        check(isOpen(now)) { "invitation is not open" }
        acceptedAt = now
    }
}
