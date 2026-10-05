package app.cetele.server.tenancy

import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import app.cetele.server.tenancy.TenancyFixtures.Companion.expectProblem
import com.jayway.jsonpath.JsonPath
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpHeaders.AUTHORIZATION
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.patch
import org.springframework.test.web.servlet.post
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Spec section 6 item 6 for the tenancy DTOs: one negative test per constraint. Every rejection is
 * 422 `validation.failed` with the field and a machine code, never the submitted value, and
 * nothing is written.
 */
@IntegrationTest
class ShopValidationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired auth: TestAuth,
    @Autowired private val jdbc: JdbcTemplate,
) {
    private val fixtures = TenancyFixtures(mvc, auth, jdbc)

    private fun assertFieldError(
        body: String,
        field: String,
        code: String,
    ) {
        val errors = JsonPath.read<List<Map<String, String>>>(body, "$.errors")
        assertTrue(errors.contains(mapOf("field" to field, "code" to code)), "expected $field/$code in $errors")
    }

    @ParameterizedTest(name = "POST shops: {0}")
    @MethodSource("invalidShops")
    fun `invalid shop creation is rejected per constraint`(
        case: String,
        json: String,
        field: String,
        code: String,
    ) {
        val owner = fixtures.actor()
        val body =
            mvc
                .post("/v1/shops") {
                    header(AUTHORIZATION, owner.bearer)
                    contentType = MediaType.APPLICATION_JSON
                    content = json
                }.expectProblem(422, "validation.failed")
        assertFieldError(body, field, code)
        assertFalse(body.contains(SENTINEL), "the submitted value is echoed")
        val owned = jdbc.queryForObject("SELECT count(*) FROM memberships WHERE user_id = ?", Int::class.java, owner.id)
        assertEquals(0, owned, case)
    }

    @ParameterizedTest(name = "PATCH shops: {0}")
    @MethodSource("invalidPatches")
    fun `invalid shop updates are rejected and change nothing`(
        case: String,
        json: String,
        field: String,
        code: String,
    ) {
        val world = fixtures.world()
        val body =
            mvc
                .patch("/v1/shops/${world.shopId}") {
                    header(AUTHORIZATION, world.owner.bearer)
                    contentType = MediaType.APPLICATION_JSON
                    content = json
                }.expectProblem(422, "validation.failed")
        assertFieldError(body, field, code)
        val row = jdbc.queryForMap("SELECT name, type, plan FROM shops WHERE id = ?", world.shopId)
        assertEquals(mapOf("name" to "Yıldız Bakkal", "type" to "BAKKAL", "plan" to "FREE"), row, case)
    }

    @ParameterizedTest(name = "POST invitations: {0}")
    @MethodSource("invalidInvitations")
    fun `invalid invitation phones are rejected`(
        case: String,
        json: String,
        code: String,
    ) {
        val world = fixtures.world()
        val body =
            mvc
                .post("/v1/shops/${world.shopId}/invitations") {
                    header(AUTHORIZATION, world.owner.bearer)
                    contentType = MediaType.APPLICATION_JSON
                    content = json
                }.expectProblem(422, "validation.failed")
        assertFieldError(body, "phone", code)
        assertEquals(0, fixtures.invitationCount(world.shopId), case)
    }

    @Test
    fun `a valid update changes only the given fields and trims text`() {
        val world = fixtures.world()
        mvc
            .patch("/v1/shops/${world.shopId}") {
                header(AUTHORIZATION, world.owner.bearer)
                contentType = MediaType.APPLICATION_JSON
                content = """{"name":"  Öz Manav  ","type":"MANAV"}"""
            }.andExpect {
                status { isOk() }
                jsonPath("$.name") { value("Öz Manav") }
                jsonPath("$.type") { value("MANAV") }
                jsonPath("$.il") { value("İstanbul") }
                jsonPath("$.plan") { value("FREE") }
                jsonPath("$.role") { value("OWNER") }
            }
    }

    @Test
    fun `a body that is not JSON is refused`() {
        val owner = fixtures.actor()
        mvc
            .post("/v1/shops") {
                header(AUTHORIZATION, owner.bearer)
                contentType = MediaType.TEXT_PLAIN
                content = "name=Bakkal"
            }.expectProblem(415, "unsupported_media_type")
    }

    companion object {
        /** A marker inside invalid values; it must never come back in a response. */
        private const val SENTINEL = "Qz7Sentinel"

        private fun shop(
            name: String = "\"Yıldız Bakkal\"",
            type: String = "\"BAKKAL\"",
            il: String = "\"İstanbul\"",
            ilce: String = "\"Kadıköy\"",
            extra: String = "",
        ): String {
            val members =
                listOfNotNull(
                    name.takeIf { it.isNotEmpty() }?.let { "\"name\":$it" },
                    type.takeIf { it.isNotEmpty() }?.let { "\"type\":$it" },
                    il.takeIf { it.isNotEmpty() }?.let { "\"il\":$it" },
                    ilce.takeIf { it.isNotEmpty() }?.let { "\"ilce\":$it" },
                    extra.takeIf { it.isNotEmpty() },
                )
            return members.joinToString(",", "{", "}")
        }

        private val tooLong = "\"" + SENTINEL + "a".repeat(80) + "\""

        @JvmStatic
        fun invalidShops(): List<Arguments> =
            listOf(
                Arguments.of("name missing", shop(name = ""), "name", "required"),
                Arguments.of("name empty", shop(name = "\"\""), "name", "required"),
                Arguments.of("name blank", shop(name = "\"   \""), "name", "invalid_format"),
                Arguments.of("name too long", shop(name = tooLong), "name", "too_long"),
                Arguments.of("name with control character", shop(name = "\"Bak\\u0007kal$SENTINEL\""), "name", "invalid_format"),
                Arguments.of("name null", shop(name = "null"), "name", "required"),
                Arguments.of("type missing", shop(type = ""), "type", "required"),
                Arguments.of("type unknown", shop(type = "\"SUPERMARKET$SENTINEL\""), "type", "invalid_format"),
                Arguments.of("type lowercase", shop(type = "\"bakkal\""), "type", "invalid_format"),
                Arguments.of("il missing", shop(il = ""), "il", "required"),
                Arguments.of("il too long", shop(il = tooLong), "il", "too_long"),
                Arguments.of("il blank", shop(il = "\" \""), "il", "invalid_format"),
                Arguments.of("ilce missing", shop(ilce = ""), "ilce", "required"),
                Arguments.of("ilce too long", shop(ilce = tooLong), "ilce", "too_long"),
                Arguments.of("plan is not writable", shop(extra = "\"plan\":\"PRO\""), "plan", "unknown_property"),
                Arguments.of("unknown property", shop(extra = "\"ownerId\":\"$SENTINEL\""), "ownerId", "unknown_property"),
                Arguments.of(
                    "shop id from the body is not accepted",
                    shop(extra = "\"shopId\":\"$SENTINEL\""),
                    "shopId",
                    "unknown_property",
                ),
            )

        @JvmStatic
        fun invalidPatches(): List<Arguments> =
            listOf(
                Arguments.of("plan is not writable", """{"plan":"PRO"}""", "plan", "unknown_property"),
                Arguments.of("plan next to a valid change", """{"name":"Yeni","plan":"PRO"}""", "plan", "unknown_property"),
                Arguments.of("name empty", """{"name":""}""", "name", "required"),
                Arguments.of("name too long", """{"name":$tooLong}""", "name", "too_long"),
                Arguments.of("name blank", """{"name":"  "}""", "name", "invalid_format"),
                Arguments.of("type unknown", """{"type":"OTEL"}""", "type", "invalid_format"),
                Arguments.of("ilce too long", """{"ilce":$tooLong}""", "ilce", "too_long"),
                Arguments.of("created_by is not writable", """{"createdBy":"$SENTINEL"}""", "createdBy", "unknown_property"),
            )

        @JvmStatic
        fun invalidInvitations(): List<Arguments> =
            listOf(
                Arguments.of("phone missing", "{}", "required"),
                Arguments.of("phone null", """{"phone":null}""", "required"),
                Arguments.of("national format", """{"phone":"05551234567"}""", "invalid_format"),
                Arguments.of("landline", """{"phone":"+902161234567"}""", "invalid_format"),
                Arguments.of("too short", """{"phone":"+90555123456"}""", "invalid_format"),
                Arguments.of("foreign number", """{"phone":"+4915112345678"}""", "invalid_format"),
                Arguments.of("letters", """{"phone":"+90555ABC4567"}""", "invalid_format"),
                Arguments.of("number type", """{"phone":905551234567}""", "invalid_format"),
            )
    }
}
