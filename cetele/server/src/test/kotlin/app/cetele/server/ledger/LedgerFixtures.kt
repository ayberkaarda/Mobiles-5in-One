package app.cetele.server.ledger

import app.cetele.server.config.CeteleTime
import app.cetele.server.security.TraceIdFilter
import app.cetele.server.support.TestUsers
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Clock
import java.time.LocalDate
import java.util.UUID

class LedgerFixtures(
    private val jdbc: JdbcTemplate,
    private val clock: Clock = Clock.systemUTC(),
) {
    fun customer(
        shopId: UUID,
        name: String = "Ayşe Yılmaz",
        phone: String? = TestUsers.phone(),
        smsConsent: Boolean = false,
        createdBy: UUID? = null,
    ): UUID {
        val id = TraceIdFilter.uuidV7()
        jdbc.update(
            "INSERT INTO customers (id, shop_id, name, phone_e164, sms_consent, sms_consent_at, sms_consent_source, created_by) VALUES (?, ?, ?, ?, ?, CASE WHEN ? THEN now() ELSE NULL END, CASE WHEN ? THEN 'IN_PERSON' ELSE NULL END, ?)",
            id,
            shopId,
            name,
            phone,
            smsConsent,
            smsConsent,
            smsConsent,
            createdBy,
        )
        return id
    }

    fun deleteCustomer(
        shopId: UUID,
        id: UUID,
    ) {
        jdbc.update("UPDATE customers SET deleted_at = now(), updated_at = now() WHERE shop_id = ? AND id = ?", shopId, id)
    }

    fun entry(
        shopId: UUID,
        customerId: UUID,
        type: String = "DEBT",
        amountMinor: Long = 12_500L,
        occurredOn: LocalDate = CeteleTime.today(clock),
        note: String? = null,
        photoKey: String? = null,
        reverses: UUID? = null,
        createdBy: UUID? = null,
    ): UUID {
        val id = TraceIdFilter.uuidV7()
        jdbc.update(
            "INSERT INTO ledger_entries (id, shop_id, customer_id, client_id, type, amount_minor, occurred_on, note, photo_key, reverses, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            id,
            shopId,
            customerId,
            TraceIdFilter.uuidV7(),
            type,
            amountMinor,
            occurredOn,
            note,
            photoKey,
            reverses,
            createdBy,
        )
        if (reverses != null) jdbc.update("UPDATE ledger_entries SET reversed_by = ? WHERE shop_id = ? AND id = ?", id, shopId, reverses)
        return id
    }

    fun balance(
        shopId: UUID,
        customerId: UUID,
    ): Long =
        jdbc.queryForObject(
            "SELECT COALESCE(sum(CASE WHEN type = 'DEBT' THEN amount_minor ELSE -amount_minor END), 0) FROM ledger_entries WHERE shop_id = ? AND customer_id = ? AND reverses IS NULL AND reversed_by IS NULL",
            Long::class.java,
            shopId,
            customerId,
        )!!

    fun head(shopId: UUID): Long =
        jdbc.queryForList("SELECT last_seq FROM shop_sequences WHERE shop_id = ?", Long::class.java, shopId).firstOrNull() ?: 0L
}
