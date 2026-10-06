package app.cetele.server.security

import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemErrorController
import app.cetele.server.web.problem.ProblemException
import app.cetele.server.web.problem.ProblemWriter
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.ResultActionsDsl
import org.springframework.test.web.servlet.delete
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

@IntegrationTest
class ProblemTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val auth: TestAuth,
    @Autowired private val json: ObjectMapper,
    @Autowired private val writer: ProblemWriter,
) {
    private val base = ProbeController.BASE

    @Test
    fun `registry codes are unique and carry the contract statuses`() {
        val expected =
            mapOf(
                "auth.unauthenticated" to 401,
                "auth.integrity_required" to 403,
                "auth.integrity_invalid" to 403,
                "auth.otp_invalid" to 401,
                "auth.refresh_invalid" to 401,
                "forbidden" to 403,
                "not_found" to 404,
                "validation.failed" to 422,
                "conflict" to 409,
                "membership.owner_locked" to 409,
                "membership.already_member" to 409,
                "rate_limited" to 429,
                "payload_too_large" to 413,
                "unsupported_media_type" to 415,
                "server_error" to 500,
                "auth.reauth_invalid" to 403,
                "customer.deleted" to 409,
                "ledger.already_reversed" to 409,
                "ledger.reversal_mismatch" to 422,
                "plan.customer_limit" to 409,
                "plan.photo_limit" to 409,
                "sms.quota_exceeded" to 429,
                "sms.daily_cap_reached" to 429,
                "sms.consent_missing" to 409,
                "sms.phone_missing" to 409,
                "sms.provider_failed" to 502,
                "reminder.no_balance" to 409,
                "statement.link_limit" to 409,
                "media.invalid" to 422,
                "media.not_uploaded" to 409,
                "media.too_large" to 413,
                "media.not_ready" to 409,
                "account.owner_of_shared_shop" to 409,
                "account.deletion_pending" to 409,
                "shop.deletion_pending" to 409,
            )
        assertEquals(
            ProblemCode.entries.size,
            ProblemCode.entries
                .map { it.code }
                .toSet()
                .size,
        )
        assertEquals(expected, ProblemCode.entries.associate { it.code to it.status.value() })
        ProblemCode.entries.forEach { code ->
            assertEquals("https://cetele.app/problems/${code.code}", code.type.toString())
            assertTrue(code.title.isNotBlank() && code.title.all { it.code < 128 }, "title must be plain English: ${code.code}")
        }
    }

    @Test
    fun `unknown route returns the generic not_found body with a server trace id`() {
        val result =
            mvc
                .get("/v1/nothing-here") {
                    header(HttpHeaders.AUTHORIZATION, auth.bearer(auth.user()))
                    header("X-Trace-Id", "client-chosen")
                }.andExpect {
                    status { isNotFound() }
                    content { contentType(MediaType.APPLICATION_PROBLEM_JSON) }
                }.andReturn()
        val body = json.readTree(result.response.contentAsString)
        assertEquals(setOf("type", "title", "status", "code", "traceId"), body.propertyNames().toSet())
        assertEquals("https://cetele.app/problems/not_found", body["type"].asString())
        assertEquals("not_found", body["code"].asString())
        assertEquals(404, body["status"].asInt())
        val traceId = result.response.getHeader("X-Trace-Id")
        assertEquals(traceId, body["traceId"].asString())
        assertNotEquals("client-chosen", traceId)
        assertEquals(7, UUID.fromString(traceId).version())
    }

    @Test
    fun `missing token returns auth unauthenticated`() {
        problem(mvc.get("$base/me"), HttpStatus.UNAUTHORIZED, "auth.unauthenticated")
    }

    @Test
    fun `forced exception returns the generic body only`() {
        val body = problem(mvc.get("$base/boom") { authorized() }, HttpStatus.INTERNAL_SERVER_ERROR, "server_error")
        val text = body.toString()
        assertFalse(text.contains(ProbeController.PROBE_DETAIL_MARKER))
        assertFalse(text.contains("IllegalStateException"))
        listOf("detail", "message", "exception", "trace", "stackTrace", "errors").forEach { assertFalse(body.has(it), it) }
    }

    @Test
    fun `problem exception headers reach the response`() {
        mvc.get("$base/rate-limited") { authorized() }.andExpect {
            status { isTooManyRequests() }
            header { string("Retry-After", "42") }
            jsonPath("$.code") { value("rate_limited") }
        }
    }

    @Test
    fun `field errors are codes and never echo the submitted values`() {
        val longName = "n".repeat(81)
        val body =
            problem(
                mvc.post("$base/echo") {
                    authorized()
                    contentType = MediaType.APPLICATION_JSON
                    content = """{"phone":"+12025550123","name":"$longName","amount":1000}"""
                },
                HttpStatus.UNPROCESSABLE_CONTENT,
                "validation.failed",
            )
        assertEquals(
            mapOf("phone" to "invalid_format", "name" to "too_long", "amount" to "out_of_range"),
            body["errors"].associate { it["field"].asString() to it["code"].asString() },
        )
        body["errors"].forEach { assertEquals(setOf("field", "code"), it.propertyNames().toSet()) }
        assertFalse(body.toString().contains("2025550123"))
        assertFalse(body.toString().contains(longName))
    }

    @Test
    fun `empty name is reported as required`() {
        val body = postEcho("""{"phone":"+905551112233","name":""}""")
        assertEquals("name" to "required", body["errors"].single().let { it["field"].asString() to it["code"].asString() })
    }

    @Test
    fun `missing required property is reported as required`() {
        val body = postEcho("""{"phone":"+905551112233"}""")
        assertEquals("name" to "required", body["errors"].single().let { it["field"].asString() to it["code"].asString() })
    }

    @Test
    fun `unknown property is rejected`() {
        val body = postEcho("""{"phone":"+905551112233","name":"Bakkal","plan":"PRO"}""")
        assertEquals("plan" to "unknown_property", body["errors"].single().let { it["field"].asString() to it["code"].asString() })
    }

    @Test
    fun `wrong value type is reported as invalid_format`() {
        val body = postEcho("""{"phone":"+905551112233","name":"Bakkal","amount":"many"}""")
        assertEquals("amount" to "invalid_format", body["errors"].single().let { it["field"].asString() to it["code"].asString() })
    }

    @Test
    fun `malformed json is a validation failure without details`() {
        val body = postEcho("""{"phone": """)
        assertFalse(body.has("errors"))
    }

    @Test
    fun `valid body passes`() {
        mvc
            .post("$base/echo") {
                authorized()
                contentType = MediaType.APPLICATION_JSON
                content = """{"phone":"+905551112233","name":"Bakkal","amount":5}"""
            }.andExpect { status { isOk() } }
    }

    @Test
    fun `non json body on the api is 415`() {
        problem(
            mvc.post("$base/echo") {
                authorized()
                contentType = MediaType.TEXT_PLAIN
                content = "phone=1"
            },
            HttpStatus.UNSUPPORTED_MEDIA_TYPE,
            "unsupported_media_type",
        )
        problem(
            mvc.post("$base/echo") {
                authorized()
                contentType = MediaType.MULTIPART_FORM_DATA
                content = "--x--"
            },
            HttpStatus.UNSUPPORTED_MEDIA_TYPE,
            "unsupported_media_type",
        )
    }

    @Test
    fun `body over one megabyte is 413`() {
        val big = "{\"name\":\"" + "a".repeat(1024 * 1024) + "\"}"
        problem(
            mvc.post("$base/echo") {
                authorized()
                contentType = MediaType.APPLICATION_JSON
                content = big
            },
            HttpStatus.CONTENT_TOO_LARGE,
            "payload_too_large",
        )
    }

    @Test
    fun `streamed body without content length is cut at the limit`() {
        val filter = RequestBodyLimitFilter(writer, maxBytes = 16)
        val request =
            object : MockHttpServletRequest("POST", "/v1/test-probe/echo") {
                override fun getContentLengthLong(): Long = -1
            }
        request.contentType = MediaType.APPLICATION_JSON_VALUE
        request.addHeader(HttpHeaders.TRANSFER_ENCODING, "chunked")
        request.setContent(ByteArray(64) { 'a'.code.toByte() })
        val error =
            assertFailsWith<ProblemException> {
                filter.doFilter(request, MockHttpServletResponse()) { req, _ -> req.inputStream.readAllBytes() }
            }
        assertEquals(ProblemCode.PAYLOAD_TOO_LARGE, error.code)
    }

    @Test
    fun `unsupported method and malformed path ids look like unknown resources`() {
        problem(mvc.delete("$base/echo") { authorized() }, HttpStatus.NOT_FOUND, "not_found")
        problem(mvc.get("$base/items/not-a-uuid") { authorized() }, HttpStatus.NOT_FOUND, "not_found")
    }

    @Test
    fun `method security denial is forbidden`() {
        problem(mvc.get("$base/denied") { authorized() }, HttpStatus.FORBIDDEN, "forbidden")
    }

    @Test
    fun `a permission check without membership answers 404 before 403`() {
        problem(mvc.get("$base/shops/${UUID.randomUUID()}") { authorized() }, HttpStatus.NOT_FOUND, "not_found")
        problem(mvc.get("$base/shops/${ProbePermission.MEMBER_SHOP}") { authorized() }, HttpStatus.FORBIDDEN, "forbidden")
    }

    @Test
    fun `container error statuses map onto the registry`() {
        val expected =
            mapOf(
                400 to ProblemCode.VALIDATION_FAILED,
                401 to ProblemCode.AUTH_UNAUTHENTICATED,
                403 to ProblemCode.FORBIDDEN,
                404 to ProblemCode.NOT_FOUND,
                405 to ProblemCode.NOT_FOUND,
                413 to ProblemCode.PAYLOAD_TOO_LARGE,
                415 to ProblemCode.UNSUPPORTED_MEDIA_TYPE,
                429 to ProblemCode.RATE_LIMITED,
                500 to ProblemCode.SERVER_ERROR,
                503 to ProblemCode.SERVER_ERROR,
            )
        expected.forEach { (status, code) -> assertEquals(code, ProblemErrorController.codeForStatus(status), "status $status") }
    }

    private fun postEcho(body: String): JsonNode =
        problem(
            mvc.post("$base/echo") {
                authorized()
                contentType = MediaType.APPLICATION_JSON
                content = body
            },
            HttpStatus.UNPROCESSABLE_CONTENT,
            "validation.failed",
        )

    private fun org.springframework.test.web.servlet.MockHttpServletRequestDsl.authorized() {
        header(HttpHeaders.AUTHORIZATION, auth.bearer(auth.user()))
    }

    private fun problem(
        actions: ResultActionsDsl,
        status: HttpStatus,
        code: String,
    ): JsonNode {
        val response =
            actions
                .andExpect {
                    status { isEqualTo(status.value()) }
                    content { contentType(MediaType.APPLICATION_PROBLEM_JSON) }
                }.andReturn()
                .response
        val body = json.readTree(response.contentAsString)
        assertEquals(code, body["code"].asString())
        assertEquals(status.value(), body["status"].asInt())
        assertEquals(response.getHeader("X-Trace-Id"), body["traceId"].asString())
        return body
    }
}
