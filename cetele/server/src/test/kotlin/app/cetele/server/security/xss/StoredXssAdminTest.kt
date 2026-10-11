package app.cetele.server.security.xss

import app.cetele.server.admin.AdminIntegrationTest
import app.cetele.server.admin.AdminRole
import app.cetele.server.auth.integrity.FakeIntegrityVerifier
import app.cetele.server.reminders.sms.FakeSmsGateway
import app.cetele.server.reminders.sms.SmsGateway
import app.cetele.server.support.IntegrationTest
import app.cetele.server.tenancy.Actor
import app.cetele.server.tenancy.TenancyFixtures
import com.jayway.jsonpath.JsonPath
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpHeaders.AUTHORIZATION
import org.springframework.http.MediaType
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.mock.web.MockHttpSession
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.patch
import org.springframework.test.web.servlet.post
import tools.jackson.databind.ObjectMapper
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Item 16 on the console: each payload becomes a user's display name (`PATCH /v1/me`), a shop's
 * name, il and ilce (`POST /v1/shops`), and a device's model and app version (the real OTP sign-in),
 * and is searched for on the shop search page; every console page that shows them is checked.
 */
@IntegrationTest
class StoredXssAdminTest : AdminIntegrationTest() {
    @Autowired lateinit var mapper: ObjectMapper

    @Autowired lateinit var gateway: SmsGateway

    private data class Written(
        val payload: String,
        val owner: Actor,
        val shopId: UUID,
    )

    private fun ip(): String = "10.${(1..3).joinToString(".") { (1..254).random().toString() }}"

    private fun json(
        path: String,
        body: Any,
        bearer: String? = null,
        patch: Boolean = false,
        ip: String = ip(),
    ): MockHttpServletResponse {
        val content = mapper.writeValueAsString(body)
        val result =
            if (patch) {
                mvc.patch(path) {
                    if (bearer != null) header(AUTHORIZATION, bearer)
                    contentType = MediaType.APPLICATION_JSON
                    this.content = content
                    with { it.apply { remoteAddr = ip } }
                }
            } else {
                mvc.post(path) {
                    if (bearer != null) header(AUTHORIZATION, bearer)
                    contentType = MediaType.APPLICATION_JSON
                    this.content = content
                    with { it.apply { remoteAddr = ip } }
                }
            }
        return result.andReturn().response
    }

    private fun write(payload: String): Written {
        val owner = TenancyFixtures(mvc, auth, jdbc).actor()
        val renamed = json("/v1/me", mapOf("displayName" to payload), owner.bearer, patch = true)
        assertEquals(200, renamed.status, renamed.contentAsString)
        val created = json("/v1/shops", mapOf("name" to payload, "type" to "BAKKAL", "il" to payload, "ilce" to payload), owner.bearer)
        assertEquals(201, created.status, created.contentAsString)
        val shopId = UUID.fromString(JsonPath.read<String>(created.contentAsString, "$.id"))
        // A device registered by the real sign-in, with the payload as its model and app version.
        val address = ip()
        val deviceId = UUID.randomUUID()
        val requested =
            json(
                "/v1/auth/otp/request",
                mapOf("phone" to owner.phone, "deviceId" to deviceId.toString(), "integrityToken" to FakeIntegrityVerifier.OK),
                ip = address,
            )
        assertEquals(202, requested.status, requested.contentAsString)
        val code = CODE.find((gateway as FakeSmsGateway).lastMessageTo(owner.phone)!!.text)!!.value
        val version = if (payload.length <= 32) payload else XssCorpus.short.first()
        val verified =
            json(
                "/v1/auth/otp/verify",
                mapOf(
                    "phone" to owner.phone,
                    "deviceId" to deviceId.toString(),
                    "code" to code,
                    "model" to payload,
                    "appVersion" to version,
                ),
                ip = address,
            )
        assertEquals(200, verified.status, verified.contentAsString)
        assertEquals(payload, jdbc.queryForObject("SELECT display_name FROM users WHERE id = ?", String::class.java, owner.id))
        assertEquals(payload, jdbc.queryForObject("SELECT name FROM shops WHERE id = ?", String::class.java, shopId))
        return Written(payload, owner, shopId)
    }

    private fun console(
        path: String,
        session: MockHttpSession,
        where: String,
        vararg params: Pair<String, String>,
    ): String {
        val response =
            mvc
                .get(path) {
                    this.session = session
                    params.forEach { (name, value) -> param(name, value) }
                }.andReturn()
                .response
        assertEquals(200, response.status, "$where: ${response.contentAsString}")
        assertEquals("text/html;charset=utf-8", response.contentType?.replace(" ", "")?.lowercase())
        HtmlInspector.assertHeaders(response, where)
        val html = response.contentAsString
        HtmlInspector.assertInert(html, where)
        return html
    }

    @Test
    fun `console pages show stored and searched payloads as inert text`() {
        val (_, session) = admins.signedIn(AdminRole.ADMIN)
        XssCorpus.all.forEach { payload ->
            val written = write(payload)
            val where = "[$payload]"

            val search = console("/admin/shops", session, "shop search $where", "q" to payload)
            val input = HtmlInspector.tags(search).single { it.name == "input" && it.attribute("name") == "q" }
            assertEquals(payload, input.attribute("value"), "shop search $where echoes the query as an attribute value")
            HtmlInspector.assertShowsText(search, payload, "shop search $where")

            val shop = console("/admin/shops/${written.shopId}", session, "shop page $where")
            HtmlInspector.assertShowsText(shop, payload, "shop page $where")
            HtmlInspector.assertShowsText(shop, "$payload / $payload", "shop page il/ilce $where")

            val user = console("/admin/users/${written.owner.id}", session, "user page $where")
            val lines = HtmlInspector.text(user).lines()
            assertTrue(lines.count { it == payload } >= 3, "user page $where: display name, shop name and device model")
            val revoke = HtmlInspector.tags(user).single { it.attribute("aria-label")?.startsWith("Oturumları kapat: ") == true }
            assertEquals("Oturumları kapat: $payload", revoke.attribute("aria-label"))

            val found = console("/admin/users", session, "user search $where", "phone" to written.owner.phone)
            HtmlInspector.assertShowsText(found, payload, "user search $where")

            val refused = console("/admin/users", session, "user search refused $where", "phone" to payload)
            assertFalse(HtmlInspector.text(refused).contains(payload), "user search $where does not echo the refused value")
        }
        console("/admin", session, "dashboard")
        console("/admin/audit", session, "audit")
        console("/admin/admins", session, "admins")
    }

    private companion object {
        val CODE = Regex("""\b\d{6}\b""")
    }
}
