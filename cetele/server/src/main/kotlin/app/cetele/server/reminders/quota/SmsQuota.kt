package app.cetele.server.reminders.quota

import app.cetele.server.tenancy.TenantScoped
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.IdClass
import jakarta.persistence.Table
import java.io.Serializable
import java.time.LocalDate
import java.util.UUID

data class SmsQuotaId(
    var shopId: UUID? = null,
    var month: LocalDate? = null,
) : Serializable

@Entity
@Table(name = "sms_quota")
@IdClass(SmsQuotaId::class)
class SmsQuota(
    @Id
    @Column(name = "shop_id", nullable = false, updatable = false)
    override val shopId: UUID,
    @Id
    @Column(name = "month", nullable = false, updatable = false)
    val month: LocalDate,
    @Column(name = "used", nullable = false)
    var used: Int = 0,
) : TenantScoped
