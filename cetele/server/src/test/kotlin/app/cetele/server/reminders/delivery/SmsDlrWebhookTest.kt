package app.cetele.server.reminders.delivery

import app.cetele.server.reminders.ReminderFixtures
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.LogCapture
import app.cetele.server.support.TestAuth
import app.cetele.server.support.assertNoneOf
import app.cetele.server.tenancy.TenancyFixtures.Companion.expectProblem
import app.cetele.server.tenancy.TenancyFixtures.Companion.withoutTraceId
import com.jayway.jsonpath.JsonPath
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.TestPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.ResultActionsDsl
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

internal const val DLR_SECRET = "local-dlr-secret-not-for-production"
internal const val DLR_PREVIOUS_SECRET = "previous-dlr-secret-for-rotation-test-0123456789"
internal const val DLR_ALLOWED_IP = "10.20.30.10"

/** One shared context for every delivery-report integration test: secrets and allowlist are set here. */
@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
@IntegrationTest
@TestPropertySource(
    properties = [
        "cetele.sms.dlr.secret=$DLR_SECRET",
        "cetele.sms.dlr.previous-secret=$DLR_PREVIOUS_SECRET",
        "cetele.sms.dlr.allowed-ips=10.20.30.0/24,2001:db8::/32",
    ],
)
internal annotation class DlrIntegrationTest

@DlrIntegrationTest
@LogCapture
class SmsDlrWebhookTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val auth: TestAuth,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val clock: Clock,
    @Autowired private val processor: DeliveryReportProcessor,
) {
    private fun nowSeconds(): Long = clock.instant().epochSecond

    private fun report(
        id: String,
        status: String = "DELIVERED",
        errorCode: String? = null,
        occurredAt: Instant = clock.instant().truncatedTo(ChronoUnit.SECONDS),
    ): String =
        buildString {
            append("""{"providerMessageId":"$id","status":"$status","occurredAt":"$occurredAt"""")
            if (errorCode != null) append(""","errorCode":"$errorCode"""")
            append("}")
        }

    private fun send(
        body: String,
        secret: String? = DLR_SECRET,
        timestamp: Long? = nowSeconds(),
        signature: String? = null,
        address: String = DLR_ALLOWED_IP,
    ): ResultActionsDsl =
        mvc.post("/v1/webhooks/sms-dlr") {
            contentType = org.springframework.http.MediaType.APPLICATION_JSON
            content = body
            with { request ->
                request.remoteAddr = address
                request
            }
            if (timestamp != null) header("X-Cetele-Timestamp", timestamp.toString())
            val value =
                signature ?: secret?.let { "v1=" + DlrSignatureVerifier.sign(it, (timestamp ?: 0L).toString(), body.toByteArray()) }
            if (value != null) header("X-Cetele-Signature", value)
        }

    private fun ResultActionsDsl.expectOk() {
        val response = andReturn().response
        assertEquals(200, response.status, response.contentAsString)
        assertEquals("", response.contentAsString)
    }

    private fun unique(prefix: String = "dlr") = "$prefix-${UUID.randomUUID()}"

    private fun reportRow(providerId: String): Map<String, Any?>? =
        jdbc.queryForList("SELECT * FROM sms_delivery_reports WHERE provider_msg_id = ?", providerId).firstOrNull()

    private fun reportCount(providerId: String): Int =
        jdbc.queryForObject("SELECT count(*) FROM sms_delivery_reports WHERE provider_msg_id = ?", Int::class.java, providerId)!!

    private class Sent(
        val reminderId: UUID,
        val providerId: String,
    )

    private fun sentReminder(): Sent {
        val f = ReminderFixtures(mvc, auth, jdbc)
        val body =
            f
                .send(f.customer())
                .andExpect { status { isCreated() } }
                .andReturn()
                .response.contentAsString
        return Sent(UUID.fromString(JsonPath.read(body, "$.reminderId")), JsonPath.read(body, "$.providerMessageId"))
    }

    private fun awaitProcessing(
        providerId: String,
        expected: String,
    ): Map<String, Any?> {
        val deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos()
        var row = reportRow(providerId)
        while (row?.get("processing") != expected && System.nanoTime() < deadline) {
            Thread.sleep(25)
            row = reportRow(providerId)
        }
        return assertNotNull(row)
    }

    private fun reminderRow(id: UUID): Map<String, Any?> = jdbc.queryForMap("SELECT * FROM reminders WHERE id = ?", id)

    @Test
    fun `valid report is stored and marks the reminder delivered`() {
        val sent = sentReminder()
        val occurred = clock.instant().truncatedTo(ChronoUnit.SECONDS).minusSeconds(30)
        send(report(sent.providerId, occurredAt = occurred)).expectOk()
        val row = awaitProcessing(sent.providerId, "APPLIED")
        assertEquals("delivered", row["outcome"])
        val reminder = reminderRow(sent.reminderId)
        assertEquals("DELIVERED", reminder["status"])
        assertEquals(occurred, (reminder["delivered_at"] as java.sql.Timestamp).toInstant())
        assertNull(reminder["failure_code"])
    }

    @Test
    fun `undelivered report records the provider error code`() {
        val sent = sentReminder()
        send(report(sent.providerId, status = "UNDELIVERED", errorCode = "E12")).expectOk()
        awaitProcessing(sent.providerId, "APPLIED")
        val reminder = reminderRow(sent.reminderId)
        assertEquals("UNDELIVERED", reminder["status"])
        assertEquals("dlr.E12", reminder["failure_code"])
        assertNull(reminder["delivered_at"])
    }

    @Test
    fun `undelivered without a code uses the generic failure code`() {
        val sent = sentReminder()
        send(report(sent.providerId, status = "UNDELIVERED")).expectOk()
        awaitProcessing(sent.providerId, "APPLIED")
        assertEquals("dlr.undelivered", reminderRow(sent.reminderId)["failure_code"])
    }

    @Test
    fun `a reminder whose send outcome was unknown becomes delivered`() {
        val sent = sentReminder()
        jdbc.update(
            "UPDATE reminders SET status = 'FAILED', failure_code = 'outcome_unknown', delivered_at = NULL WHERE id = ?",
            sent.reminderId,
        )
        send(report(sent.providerId)).expectOk()
        awaitProcessing(sent.providerId, "APPLIED")
        val reminder = reminderRow(sent.reminderId)
        assertEquals("DELIVERED", reminder["status"])
        assertNull(reminder["failure_code"])
    }

    @Test
    fun `final and unsent reminders are left alone`() {
        val final = sentReminder()
        jdbc.update("UPDATE reminders SET status = 'DELIVERED' WHERE id = ?", final.reminderId)
        send(report(final.providerId, status = "UNDELIVERED", errorCode = "E1")).expectOk()
        assertEquals("already_final", awaitProcessing(final.providerId, "IGNORED")["outcome"])
        assertEquals("DELIVERED", reminderRow(final.reminderId)["status"])

        val rejected = sentReminder()
        jdbc.update("UPDATE reminders SET status = 'FAILED', failure_code = 'sms.provider_failed' WHERE id = ?", rejected.reminderId)
        send(report(rejected.providerId)).expectOk()
        assertEquals("not_sent", awaitProcessing(rejected.providerId, "IGNORED")["outcome"])
        assertEquals("FAILED", reminderRow(rejected.reminderId)["status"])
    }

    @Test
    fun `unknown provider id is accepted and ignored once the grace period passed`() {
        val id = unique("unknown")
        send(report(id)).expectOk()
        assertEquals(1, reportCount(id))
        // Inside the grace period the row waits: the reminder may not have stored its message id yet.
        assertEquals("RECEIVED", awaitStable(id)["processing"])
        jdbc.update("UPDATE sms_delivery_reports SET received_at = now() - interval '1 hour' WHERE provider_msg_id = ?", id)
        processor.processPending()
        val row = assertNotNull(reportRow(id))
        assertEquals("IGNORED", row["processing"])
        assertEquals("unknown_message", row["outcome"])
        assertNotNull(row["processed_at"])
    }

    private fun awaitStable(id: String): Map<String, Any?> {
        Thread.sleep(150)
        return assertNotNull(reportRow(id))
    }

    @Test
    fun `replayed provider id is 200 and stored and applied once`() {
        val sent = sentReminder()
        val body = report(sent.providerId)
        send(body).expectOk()
        send(body).expectOk()
        send(body, timestamp = nowSeconds() + 5).expectOk()
        // A conflicting second report for the same id changes nothing either.
        send(report(sent.providerId, status = "UNDELIVERED", errorCode = "E9")).expectOk()
        awaitProcessing(sent.providerId, "APPLIED")
        assertEquals(1, reportCount(sent.providerId))
        assertEquals("DELIVERED", reminderRow(sent.reminderId)["status"])
        assertEquals("DELIVERED", reportRow(sent.providerId)!!["status"])
    }

    @Test
    fun `durable index closes the replay window when the cache is empty`() {
        val id = unique("durable")
        jdbc.update(
            "INSERT INTO sms_delivery_reports (id, provider_msg_id, status, occurred_at, processing) VALUES (?, ?, 'DELIVERED', now(), 'APPLIED')",
            UUID.randomUUID(),
            id,
        )
        send(report(id)).expectOk()
        assertEquals(1, reportCount(id))
        assertEquals("APPLIED", reportRow(id)!!["processing"])
    }

    @Test
    fun `missing signature or timestamp is 401`() {
        val body = report(unique())
        send(body, secret = null).expectProblem(401, "webhook.unauthenticated")
        send(body, timestamp = null, signature = "v1=" + "0".repeat(64)).expectProblem(401, "webhook.unauthenticated")
        send(body, timestamp = null, secret = null).expectProblem(401, "webhook.unauthenticated")
    }

    @Test
    fun `malformed signature is 401`() {
        val body = report(unique())
        listOf("", "v1=", "v1=abc", "sha256=" + "0".repeat(64), "v1=" + "G".repeat(64), "v1=" + "0".repeat(65)).forEach {
            send(body, signature = it).expectProblem(401, "webhook.unauthenticated")
        }
    }

    @Test
    fun `invalid signature and wrong secret are 401 and nothing is stored`() {
        val id = unique()
        val body = report(id)
        send(body, signature = "v1=" + "0".repeat(64)).expectProblem(401, "webhook.unauthenticated")
        send(body, secret = "a-completely-different-secret-of-32-plus-bytes").expectProblem(401, "webhook.unauthenticated")
        // A valid signature of a different body does not transfer.
        val other = "v1=" + DlrSignatureVerifier.sign(DLR_SECRET, nowSeconds().toString(), report(unique()).toByteArray())
        send(body, signature = other).expectProblem(401, "webhook.unauthenticated")
        assertEquals(0, reportCount(id))
    }

    @Test
    fun `previous secret is accepted during rotation`() {
        val id = unique("rotation")
        send(report(id), secret = DLR_PREVIOUS_SECRET).expectOk()
        assertEquals(1, reportCount(id))
    }

    @Test
    fun `stale and future timestamps are 401 even when signed correctly`() {
        val id = unique()
        val body = report(id)
        send(body, timestamp = nowSeconds() - 301 - 2).expectProblem(401, "webhook.unauthenticated")
        send(body, timestamp = nowSeconds() + 301 + 2).expectProblem(401, "webhook.unauthenticated")
        send(body, timestamp = 1L).expectProblem(401, "webhook.unauthenticated")
        assertEquals(0, reportCount(id))
        send(body, timestamp = nowSeconds() - 290).expectOk()
        assertEquals(1, reportCount(id))
    }

    @Test
    fun `address outside the allowlist is 401`() {
        val id = unique()
        send(report(id), address = "192.0.2.50").expectProblem(401, "webhook.unauthenticated")
        send(report(id), address = "127.0.0.1").expectProblem(401, "webhook.unauthenticated")
        assertEquals(0, reportCount(id))
        send(report(id), address = "2001:db8::17").expectOk()
        assertEquals(1, reportCount(id))
    }

    @Test
    fun `invalid signed body is 422 with field codes only`() {
        val body = """{"providerMessageId":"","status":"MAYBE","occurredAt":"soon","note":"x"}"""
        val response = send(body).expectProblem(422, "validation.failed")
        val fields = JsonPath.read<List<Map<String, String>>>(response, "$.errors").map { it["field"] to it["code"] }
        assertTrue(("providerMessageId" to "required") in fields)
        assertTrue(("status" to "out_of_range") in fields)
        assertTrue(("occurredAt" to "invalid_format") in fields)
        assertTrue(("note" to "unknown_property") in fields)
        assertTrue(!response.contains("MAYBE") && !response.contains("soon"))
    }

    @Test
    fun `body over 8 KiB is 413 before the signature is looked at`() {
        val padding = "a".repeat(DLR_LIMIT)
        val big = """{"providerMessageId":"x","status":"DELIVERED","occurredAt":"${clock.instant()}","errorCode":"$padding"}"""
        send(big).expectProblem(413, "payload_too_large")
        send(big, secret = null).expectProblem(413, "payload_too_large")
        // Exactly at the limit still reaches the signature check and fails there as 422 (too long field).
        val head = report(unique()).dropLast(1) + ",\"errorCode\":\""
        val atLimit = head + "b".repeat(DLR_LIMIT - head.length - 2) + "\"}"
        assertEquals(DLR_LIMIT, atLimit.toByteArray().size)
        send(atLimit).expectProblem(422, "validation.failed")
    }

    @Test
    fun `all failures answer with the same body`() {
        val body = report(unique())
        val bodies =
            listOf(
                send(body, secret = null),
                send(body, signature = "v1=" + "0".repeat(64)),
                send(body, timestamp = 5L),
                send(body, address = "192.0.2.77"),
            ).map { withoutTraceId(it.expectProblem(401, "webhook.unauthenticated")) }
        assertEquals(1, bodies.toSet().size)
        assertTrue(bodies.first().keys.none { it == "detail" })
    }

    @Test
    fun `responses carry security headers and no session cookie`() {
        val id = unique()
        val response = send(report(id)).andReturn().response
        assertEquals(200, response.status)
        assertEquals("nosniff", response.getHeader("X-Content-Type-Options"))
        assertEquals("DENY", response.getHeader("X-Frame-Options"))
        assertEquals("no-store", response.getHeader("Cache-Control"))
        assertNotNull(response.getHeader("Content-Security-Policy"))
        assertNotNull(response.getHeader("Permissions-Policy"))
        assertNull(response.getHeader("Set-Cookie"))
    }

    @Test
    fun `the api chain still guards every other path`() {
        mvc.get("/v1/shops").expectProblem(401, "auth.unauthenticated")
        mvc.post("/v1/webhooks/sms-dlr-other") { content = "{}" }.expectProblem(401, "auth.unauthenticated")
        // A bearer token is not a credential for the webhook and is not looked at.
        mvc
            .post("/v1/webhooks/sms-dlr") {
                header("Authorization", "Bearer not-a-token")
                content = "{}"
            }.expectProblem(401, "webhook.unauthenticated")
    }

    @Test
    fun `secrets and signatures never reach the log`(output: CapturedOutput) {
        val id = unique("logs")
        val signature = DlrSignatureVerifier.sign(DLR_SECRET, nowSeconds().toString(), report(id).toByteArray())
        send(report(id)).expectOk()
        send(report(id), signature = "v1=" + "1".repeat(64)).expectProblem(401, "webhook.unauthenticated")
        output.assertNoneOf(DLR_SECRET, DLR_PREVIOUS_SECRET, signature, "1".repeat(64))
    }

    @Test
    fun `rate limit applies per source address before the credential check`() {
        val address = "10.20.30.250"
        val body = report(unique())
        var limited = 0
        repeat(310) {
            val response = send(body, signature = "v1=" + "0".repeat(64), address = address).andReturn().response
            if (response.status == 429) {
                limited++
                assertEquals("rate_limited", JsonPath.read<String>(response.contentAsString, "$.code"))
                assertNotNull(response.getHeader("Retry-After"))
            } else {
                assertEquals(401, response.status)
            }
        }
        assertTrue(limited >= 10, "expected the bucket of 300 to run out, limited=$limited")
    }

    private companion object {
        const val DLR_LIMIT = 8 * 1024
    }
}
