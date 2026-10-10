package app.cetele.server.reminders.delivery

import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull

@DlrIntegrationTest
class DeliveryReportProcessorTest(
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val processor: DeliveryReportProcessor,
) {
    private fun insert(
        id: String,
        status: String = "DELIVERED",
        errorCode: String? = null,
        processing: String = "RECEIVED",
        receivedAgo: String = "0 seconds",
    ) = jdbc.update(
        "INSERT INTO sms_delivery_reports (id, provider_msg_id, status, error_code, occurred_at, received_at, processing) " +
            "VALUES (?, ?, ?, ?, now(), now() - CAST(? AS interval), ?)",
        UUID.randomUUID(),
        id,
        status,
        errorCode,
        receivedAgo,
        processing,
    )

    private fun row(id: String): Map<String, Any?> = jdbc.queryForMap("SELECT * FROM sms_delivery_reports WHERE provider_msg_id = ?", id)

    @Test
    fun `sweep ignores unknown ids after the grace period and keeps recent ones waiting`() {
        val old = "sweep-old-${UUID.randomUUID()}"
        val recent = "sweep-recent-${UUID.randomUUID()}"
        insert(old, receivedAgo = "10 minutes")
        insert(recent)
        processor.processPending()
        assertEquals("IGNORED", row(old)["processing"])
        assertEquals("unknown_message", row(old)["outcome"])
        assertEquals("RECEIVED", row(recent)["processing"])
        assertEquals(0, row(recent)["attempts"])
    }

    @Test
    fun `finished reports are not processed twice`() {
        val id = "sweep-done-${UUID.randomUUID()}"
        insert(id, processing = "APPLIED")
        processor.process(UUID.fromString(row(id)["id"].toString()))
        assertEquals("APPLIED", row(id)["processing"])
        assertEquals(null, row(id)["outcome"])
    }

    @Test
    fun `scheduled sweep removes reports older than 90 days`() {
        val old = "retention-old-${UUID.randomUUID()}"
        val young = "retention-young-${UUID.randomUUID()}"
        insert(old, processing = "APPLIED", receivedAgo = "91 days")
        insert(young, processing = "APPLIED", receivedAgo = "89 days")
        processor.scheduledSweep()
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM sms_delivery_reports WHERE provider_msg_id = ?", Int::class.java, old))
        assertNotNull(row(young))
    }

    @Test
    fun `schema refuses duplicates and values outside the contract`() {
        val id = "schema-${UUID.randomUUID()}"
        insert(id)
        assertFailsWith<DataIntegrityViolationException> { insert(id) }
        assertFailsWith<DataIntegrityViolationException> { insert("schema-status-${UUID.randomUUID()}", status = "SENT") }
        assertFailsWith<DataIntegrityViolationException> { insert("bad id with spaces") }
        assertFailsWith<DataIntegrityViolationException> { insert("schema-code-${UUID.randomUUID()}", errorCode = "bad code!") }
        assertFailsWith<DataIntegrityViolationException> { insert("schema-proc-${UUID.randomUUID()}", processing = "DONE") }
        assertFailsWith<DataIntegrityViolationException> {
            jdbc.update("UPDATE sms_delivery_reports SET attempts = -1 WHERE provider_msg_id = ?", id)
        }
    }
}
