package app.cetele.server.ledger.entry

import app.cetele.server.tenancy.TenantScoped
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

@Entity
@Table(name = "ledger_entries")
class LedgerEntry(
    @Id
    @Column(name = "id", nullable = false)
    val id: UUID,
    @Column(name = "shop_id", nullable = false)
    override val shopId: UUID,
    @Column(name = "customer_id", nullable = false)
    val customerId: UUID,
    @Column(name = "client_id", nullable = false)
    val clientId: UUID,
    @Column(name = "type", nullable = false)
    val type: String,
    @Column(name = "amount_minor", nullable = false)
    val amountMinor: Long,
    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(name = "currency", nullable = false, length = 3)
    val currency: String,
    @Column(name = "occurred_on", nullable = false)
    val occurredOn: LocalDate,
    @Column(name = "due_on", nullable = true)
    val dueOn: LocalDate?,
    @Column(name = "note", nullable = true)
    val note: String?,
    @Column(name = "photo_key", nullable = true)
    val photoKey: String?,
    @Column(name = "reverses", nullable = true)
    val reverses: UUID?,
    @Column(name = "reversed_by", nullable = true)
    var reversedBy: UUID?,
    @Column(name = "created_by", nullable = true)
    val createdBy: UUID?,
    @Column(name = "created_at", nullable = false)
    val createdAt: Instant,
) : TenantScoped
