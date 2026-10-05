package app.cetele.server.security

import app.cetele.server.config.logging.Masking
import app.cetele.server.config.logging.MaskingConverter
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.LogCapture
import app.cetele.server.support.TestAuth
import app.cetele.server.support.TestUsers
import app.cetele.server.support.assertContains
import app.cetele.server.support.assertNoneOf
import app.cetele.server.web.problem.ProblemHandler
import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.LoggerContext
import ch.qos.logback.classic.spi.LoggingEvent
import org.junit.jupiter.api.Test
import org.slf4j.LoggerFactory
import org.slf4j.MDC
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.http.HttpHeaders
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import tools.jackson.databind.ObjectMapper
import java.security.SecureRandom
import java.util.Base64
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@IntegrationTest
@LogCapture
class LoggingTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val auth: TestAuth,
    @Autowired private val json: ObjectMapper,
) {
    private val log = LoggerFactory.getLogger(LoggingTest::class.java)
    private val random = SecureRandom()

    @Test
    fun `phone numbers keep only the last two digits`() {
        val phone = TestUsers.phone()
        assertEquals("sent to +90*******${phone.takeLast(2)}", Masking.mask("sent to $phone"))
        assertEquals("+90*******${phone.takeLast(2)}", Masking.phone(phone))
        val bare = phone.removePrefix("+")
        assertFalse(Masking.mask("number $bare").orEmpty().contains(bare))
        assertFalse(Masking.mask("number 0${phone.takeLast(10)}").orEmpty().contains(phone.takeLast(10)))
    }

    @Test
    fun `verification codes next to code or otp are masked`() {
        val code = digits(6)
        listOf("code=$code", "otp: $code", "\"code\":\"$code\"", "verificationCode $code", "OTP=$code").forEach { text ->
            val masked = Masking.mask(text).orEmpty()
            assertFalse(masked.contains(code), masked)
            assertTrue(masked.contains("******"), masked)
        }
    }

    @Test
    fun `credentials and long tokens are masked, ids are kept`() {
        val token = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32).also { random.nextBytes(it) }) + "9a"
        assertEquals("Authorization: ***", Masking.mask("Authorization: Bearer $token"))
        assertEquals("\"cookie\":\"***\"", Masking.mask("\"cookie\":\"session=$token\""))
        assertEquals("Set-Cookie=***", Masking.mask("Set-Cookie=a=b; Path=/"))
        assertEquals("refresh ***", Masking.mask("refresh $token"))
        val jwt = auth.token(UUID.randomUUID())
        assertEquals("jwt ***", Masking.mask("jwt $jwt"))
        val traceId = TraceIdFilter.uuidV7().toString()
        assertEquals("trace $traceId", Masking.mask("trace $traceId"))
        val identifier = "AbstractAuthenticationProcessingFilter"
        assertEquals("at org.example.$identifier.run", Masking.mask("at org.example.$identifier.run"))
        assertEquals("amount 125000 kurus", Masking.mask("amount 125000 kurus"))
    }

    @Test
    fun `plain console converter masks the rendered line`() {
        val phone = TestUsers.phone()
        val event = LoggingEvent(null, LoggerContext().getLogger("probe"), Level.INFO, "x", null, null)
        assertEquals("to +90*******${phone.takeLast(2)}", MaskingConverter().transform(event, "to $phone"))
    }

    @Test
    fun `structured log masks message, mdc, key value pairs and stack traces`(output: CapturedOutput) {
        val phone = TestUsers.phone()
        val code = digits(6)
        val token = auth.token(UUID.randomUUID())
        MDC.put("phone", phone)
        try {
            log
                .atWarn()
                .addKeyValue("otp", "code=$code")
                .addKeyValue("authorization", "Bearer $token")
                .log("login for {} with code {} failed", phone, code, IllegalStateException("phone $phone token $token"))
        } finally {
            MDC.remove("phone")
        }
        output.assertNoneOf(phone, token, "code $code", "code=$code")
        output.assertContains("+90*******" + phone.takeLast(2))
        val line = output.all.lines().last { it.contains("login for") }
        val event = json.readTree(line)
        assertEquals("WARN", event["log"]["level"].asString())
        assertTrue(event.has("error"))
    }

    @Test
    fun `request logs carry the trace id and unhandled errors stay masked`(output: CapturedOutput) {
        val response =
            mvc
                .get(ProbeController.BASE + "/boom") {
                    header(HttpHeaders.AUTHORIZATION, auth.bearer(auth.user()))
                }.andReturn()
                .response
        assertEquals(500, response.status)
        val traceId = response.getHeader(TraceIdFilter.HEADER).orEmpty()
        val line = output.all.lines().last { it.contains("Unhandled exception") }
        val event = json.readTree(line)
        assertEquals(traceId, event["traceId"].asString())
        assertEquals("ERROR", event["log"]["level"].asString())
        assertFalse(line.contains("Bearer"))
    }

    @Test
    fun `invitation codes in paths are masked`() {
        val code = invitationCode()
        assertEquals("POST /v1/invitations/***/accept", Masking.mask("POST /v1/invitations/$code/accept"))
        assertEquals("route /v1/invitations/{code}/accept", Masking.mask("route /v1/invitations/{code}/accept"))
    }

    @Test
    fun `failed invitation accept logs the route pattern, never the code`(output: CapturedOutput) {
        val handlerLogger = LoggerFactory.getLogger(ProblemHandler::class.java) as Logger
        val previous = handlerLogger.level
        handlerLogger.level = Level.DEBUG
        val code = invitationCode()
        try {
            val response =
                mvc
                    .post("/v1/invitations/$code/accept") {
                        header(HttpHeaders.AUTHORIZATION, auth.bearer(auth.user()))
                    }.andReturn()
                    .response
            assertEquals(404, response.status)
        } finally {
            handlerLogger.level = previous
        }
        output.assertContains("/v1/invitations/{code}/accept")
        output.assertNoneOf(code)
    }

    /** Eight Crockford base32 characters, the shape of a real invitation code. */
    private fun invitationCode(): String {
        val alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
        return (1..8).joinToString("") { alphabet[random.nextInt(alphabet.length)].toString() }
    }

    private fun digits(count: Int): String = (1..count).joinToString("") { random.nextInt(10).toString() }
}
