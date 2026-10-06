package app.cetele.server.auth

import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import app.cetele.server.support.TestUsers
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.patch
import tools.jackson.databind.ObjectMapper
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse

@IntegrationTest
class MeTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val json: ObjectMapper,
    @Autowired private val auth: TestAuth,
    @Autowired private val jdbc: JdbcTemplate,
) {
    @Test
    fun `me returns the masked phone, the display name and the memberships`() {
        val phone = TestUsers.phone()
        val user = auth.user(phone, displayName = "Mehmet")
        val owned = shop(user)
        membership(owned, user, "OWNER")
        val other = shop(auth.user())
        membership(other, user, "STAFF")
        val deleted = shop(user)
        membership(deleted, user, "OWNER")
        jdbc.update("UPDATE shops SET deleted_at = now() WHERE id = ?", deleted)

        val response =
            mvc
                .get("/v1/me") { header(HttpHeaders.AUTHORIZATION, auth.bearer(user)) }
                .andExpect { status { isOk() } }
                .andReturn()
                .response
        val body = json.readTree(response.contentAsString)
        assertEquals(setOf("id", "phone", "displayName", "memberships"), body.propertyNames().toSet())
        assertEquals(user.toString(), body["id"].asString())
        assertEquals(TestUsers.masked(phone), body["phone"].asString())
        assertEquals("Mehmet", body["displayName"].asString())
        val memberships = body["memberships"].values().map { it["shopId"].asString() to it["role"].asString() }.toSet()
        assertEquals(setOf(owned.toString() to "OWNER", other.toString() to "STAFF"), memberships)
        assertFalse(response.contentAsString.contains(phone.drop(3)), "the full number never leaves the server")
    }

    @Test
    fun `me without a token or for a deactivated user is 401`() {
        mvc.get("/v1/me").andExpect { status { isUnauthorized() } }
        val user = auth.user()
        val bearer = auth.bearer(user)
        auth.deactivate(user)
        mvc.get("/v1/me") { header(HttpHeaders.AUTHORIZATION, bearer) }.andExpect { status { isUnauthorized() } }
    }

    @Test
    fun `patch me changes the display name`() {
        val user = auth.user()
        mvc
            .patch("/v1/me") {
                header(HttpHeaders.AUTHORIZATION, auth.bearer(user))
                contentType = MediaType.APPLICATION_JSON
                content = """{"displayName":"  Ali Usta  "}"""
            }.andExpect {
                status { isOk() }
                jsonPath("$.displayName") { value("Ali Usta") }
            }
        assertEquals("Ali Usta", jdbc.queryForObject("SELECT display_name FROM users WHERE id = ?", String::class.java, user))
    }

    @Test
    fun `patch me rejects other properties and invalid names`() {
        val user = auth.user()
        val cases =
            mapOf(
                """{"displayName":"Ali","phone":"+905551112233"}""" to ("phone" to "unknown_property"),
                """{"displayName":""}""" to ("displayName" to "required"),
                """{"displayName":"   "}""" to ("displayName" to "required"),
                """{"displayName":"${"a".repeat(81)}"}""" to ("displayName" to "too_long"),
                """{}""" to ("displayName" to "required"),
            )
        cases.forEach { (body, expected) ->
            val response =
                mvc
                    .patch("/v1/me") {
                        header(HttpHeaders.AUTHORIZATION, auth.bearer(user))
                        contentType = MediaType.APPLICATION_JSON
                        content = body
                    }.andReturn()
                    .response
            assertEquals(422, response.status, body)
            val errors = json.readTree(response.contentAsString)["errors"].values().map { it["field"].asString() to it["code"].asString() }
            assertEquals(true, expected in errors, "$body -> $errors")
        }
        assertEquals(null, jdbc.queryForObject("SELECT display_name FROM users WHERE id = ?", String::class.java, user))
    }

    private fun shop(createdBy: UUID): UUID {
        val id = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO shops (id, name, type, il, ilce, created_by) VALUES (?, 'Bakkal', 'BAKKAL', 'İzmir', 'Konak', ?)",
            id,
            createdBy,
        )
        return id
    }

    private fun membership(
        shop: UUID,
        user: UUID,
        role: String,
    ) {
        jdbc.update("INSERT INTO memberships (id, shop_id, user_id, role) VALUES (?, ?, ?, ?)", UUID.randomUUID(), shop, user, role)
    }
}
