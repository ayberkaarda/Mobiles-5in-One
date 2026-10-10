package app.cetele.server.reminders.delivery

import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import org.junit.jupiter.api.Test
import tools.jackson.databind.json.JsonMapper
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DlrUnitTest {
    private val secret = "local-dlr-secret-not-for-production"
    private val vectorTimestamp = "1791711000"
    private val vectorBody = """{"providerMessageId":"fake-17","status":"DELIVERED","occurredAt":"2026-10-11T09:30:00Z"}"""
    private val vectorSignature = "b536397b04034ffcedb4bcd6837bea033bdc952b28ec2358a8c824c83d799d3f"

    private fun clockAt(epochSecond: Long): Clock = Clock.fixed(Instant.ofEpochSecond(epochSecond), ZoneOffset.UTC)

    private fun verifier(
        epochSecond: Long = 1_791_711_000L,
        secret: String = this.secret,
        previous: String = "",
    ) = DlrSignatureVerifier(SmsDlrProperties(secret, previous, ""), clockAt(epochSecond))

    @Test
    fun `test vector of the adr verifies`() {
        assertEquals(88, vectorBody.toByteArray().size)
        assertEquals(vectorSignature, DlrSignatureVerifier.sign(secret, vectorTimestamp, vectorBody.toByteArray()))
        assertEquals(DlrCheck.OK, verifier().check(vectorTimestamp, "v1=$vectorSignature", vectorBody.toByteArray()))
    }

    @Test
    fun `a changed body or timestamp breaks the signature`() {
        val header = "v1=$vectorSignature"
        assertEquals(DlrCheck.BAD_SIGNATURE, verifier().check(vectorTimestamp, header, (vectorBody + " ").toByteArray()))
        assertEquals(
            DlrCheck.BAD_SIGNATURE,
            verifier(1_791_711_001L).check("1791711001", header, vectorBody.toByteArray()),
        )
    }

    @Test
    fun `timestamp tolerance is exactly 300 seconds on both sides`() {
        val body = vectorBody.toByteArray()

        fun check(
            now: Long,
            ts: Long,
        ) = verifier(now).check(ts.toString(), "v1=" + DlrSignatureVerifier.sign(secret, ts.toString(), body), body)
        assertEquals(DlrCheck.OK, check(1_000_300, 1_000_000))
        assertEquals(DlrCheck.STALE_TIMESTAMP, check(1_000_301, 1_000_000))
        assertEquals(DlrCheck.OK, check(1_000_000, 1_000_300))
        assertEquals(DlrCheck.STALE_TIMESTAMP, check(1_000_000, 1_000_301))
    }

    @Test
    fun `missing and malformed headers are refused`() {
        val v = verifier()
        val body = vectorBody.toByteArray()
        assertEquals(DlrCheck.MISSING_HEADER, v.check(null, "v1=$vectorSignature", body))
        assertEquals(DlrCheck.MISSING_HEADER, v.check(vectorTimestamp, null, body))
        assertEquals(DlrCheck.MALFORMED_HEADER, v.check("17.5", "v1=$vectorSignature", body))
        assertEquals(DlrCheck.MALFORMED_HEADER, v.check("1234567890123", "v1=$vectorSignature", body))
        assertEquals(DlrCheck.MALFORMED_HEADER, v.check(vectorTimestamp, vectorSignature, body))
        assertEquals(DlrCheck.MALFORMED_HEADER, v.check(vectorTimestamp, "v1=" + vectorSignature.uppercase(), body))
        assertEquals(DlrCheck.MALFORMED_HEADER, v.check(vectorTimestamp, "v2=$vectorSignature", body))
    }

    @Test
    fun `previous secret verifies during rotation and the wrong secret does not`() {
        val old = "previous-dlr-secret-for-rotation-test-0123456789"
        val body = vectorBody.toByteArray()
        val oldSignature = "v1=" + DlrSignatureVerifier.sign(old, vectorTimestamp, body)
        assertEquals(DlrCheck.OK, verifier(previous = old).check(vectorTimestamp, oldSignature, body))
        assertEquals(DlrCheck.BAD_SIGNATURE, verifier().check(vectorTimestamp, oldSignature, body))
        val other = "v1=" + DlrSignatureVerifier.sign("another-secret-of-more-than-32-bytes!!", vectorTimestamp, body)
        assertEquals(DlrCheck.BAD_SIGNATURE, verifier(previous = old).check(vectorTimestamp, other, body))
    }

    @Test
    fun `an empty secret means not configured`() {
        val v = verifier(secret = "")
        assertEquals(DlrCheck.NOT_CONFIGURED, v.check(vectorTimestamp, "v1=$vectorSignature", vectorBody.toByteArray()))
    }

    @Test
    fun `a short secret fails startup`() {
        assertFailsWith<IllegalArgumentException> { SmsDlrProperties("too-short", "", "") }
        assertFailsWith<IllegalArgumentException> { SmsDlrProperties(secret, "short", "") }
        assertFailsWith<IllegalArgumentException> { SmsDlrProperties(secret, "", "not-an-ip") }
    }

    @Test
    fun `allowlist matches addresses and cidr blocks of both families`() {
        val list = IpAllowlist.parse("203.0.113.7, 10.20.30.0/24 ,2001:db8::/32")
        assertTrue(list.allows("203.0.113.7"))
        assertFalse(list.allows("203.0.113.8"))
        assertTrue(list.allows("10.20.30.200"))
        assertFalse(list.allows("10.20.31.1"))
        assertTrue(list.allows("2001:db8:1::5"))
        assertFalse(list.allows("2001:db9::1"))
        assertFalse(list.allows("example.com"))
        assertFalse(list.allows(""))
    }

    @Test
    fun `an empty allowlist allows every address and bad prefixes fail`() {
        assertTrue(IpAllowlist.parse("").allows("198.51.100.1"))
        assertTrue(IpAllowlist.parse(" , ").isEmpty)
        assertFailsWith<IllegalArgumentException> { IpAllowlist.parse("10.0.0.0/33") }
        assertFailsWith<IllegalArgumentException> { IpAllowlist.parse("10.0.0.0/x") }
        assertFailsWith<IllegalArgumentException> { IpAllowlist.parse("host.example") }
    }

    private val parser = DeliveryReportParser(JsonMapper.builder().build(), clockAt(1_791_711_000L))

    private fun problemFields(body: String): List<Pair<String, String>> {
        val failure = assertFailsWith<ProblemException> { parser.parse(body.toByteArray()) }
        assertEquals(ProblemCode.VALIDATION_FAILED, failure.code)
        return failure.errors.map { it.field to it.code }
    }

    @Test
    fun `parser accepts the documented body and an optional error code`() {
        val parsed = parser.parse(vectorBody.toByteArray())
        assertEquals("fake-17", parsed.providerMessageId)
        assertEquals("DELIVERED", parsed.status)
        assertEquals(Instant.parse("2026-10-11T09:30:00Z"), parsed.occurredAt)
        val withCode =
            parser.parse(
                """{"providerMessageId":"a:b.c_d-1","status":"UNDELIVERED","occurredAt":"2026-10-11T09:34:59Z","errorCode":"E12"}"""
                    .toByteArray(),
            )
        assertEquals("E12", withCode.errorCode)
    }

    @Test
    fun `parser reports field codes and never values`() {
        assertEquals(listOf("body" to "invalid_format"), problemFields("[]"))
        assertEquals(listOf("body" to "invalid_format"), problemFields("not json"))
        assertEquals(
            listOf("providerMessageId" to "required", "status" to "required", "occurredAt" to "required"),
            problemFields("{}"),
        )
        assertEquals(
            listOf("providerMessageId" to "invalid_format"),
            problemFields("""{"providerMessageId":"bad id!","status":"DELIVERED","occurredAt":"2026-10-11T09:30:00Z"}"""),
        )
        assertEquals(
            listOf("status" to "out_of_range"),
            problemFields("""{"providerMessageId":"x","status":"SENT","occurredAt":"2026-10-11T09:30:00Z"}"""),
        )
        assertEquals(
            listOf("occurredAt" to "out_of_range"),
            problemFields("""{"providerMessageId":"x","status":"DELIVERED","occurredAt":"2026-10-11T09:35:01Z"}"""),
        )
        assertEquals(
            listOf("occurredAt" to "invalid_format"),
            problemFields("""{"providerMessageId":"x","status":"DELIVERED","occurredAt":"yesterday"}"""),
        )
        assertEquals(
            listOf("extra" to "unknown_property"),
            problemFields("""{"providerMessageId":"x","status":"DELIVERED","occurredAt":"2026-10-11T09:30:00Z","extra":1}"""),
        )
        assertEquals(
            listOf("providerMessageId" to "too_long"),
            problemFields(
                """{"providerMessageId":"${"a".repeat(65)}","status":"DELIVERED","occurredAt":"2026-10-11T09:30:00Z"}""",
            ),
        )
    }
}
