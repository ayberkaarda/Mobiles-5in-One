package app.cetele.server.ledger.customer

import app.cetele.server.tenancy.TenantScoped
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "customers")
class Customer(
    @Id
    @Column(name = "id", nullable = false)
    val id: UUID,
    @Column(name = "shop_id", nullable = false)
    override val shopId: UUID,
    @Column(name = "name", nullable = false)
    var name: String,
    @Column(name = "phone_e164", nullable = true)
    var phoneE164: String?,
    @Column(name = "note", nullable = true)
    var note: String?,
    @Column(name = "tag", nullable = true)
    var tag: String?,
    @Column(name = "sms_consent", nullable = false)
    var smsConsent: Boolean,
    @Column(name = "sms_consent_at", nullable = true)
    var smsConsentAt: Instant?,
    @Column(name = "sms_consent_source", nullable = true)
    var smsConsentSource: String?,
    @Column(name = "created_by", nullable = true)
    val createdBy: UUID?,
    @Column(name = "created_at", nullable = false)
    val createdAt: Instant,
    @Column(name = "updated_at", nullable = false)
    var updatedAt: Instant,
    @Column(name = "deleted_at", nullable = true)
    var deletedAt: Instant?,
) : TenantScoped
