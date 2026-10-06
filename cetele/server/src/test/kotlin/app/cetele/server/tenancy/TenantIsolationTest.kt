package app.cetele.server.tenancy

import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import app.cetele.server.tenancy.TenancyFixtures.Companion.expectProblem
import app.cetele.server.tenancy.TenancyFixtures.Companion.withoutTraceId
import com.jayway.jsonpath.JsonPath
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpHeaders.AUTHORIZATION
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.ResultActionsDsl
import org.springframework.test.web.servlet.delete
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.patch
import org.springframework.test.web.servlet.post
import java.util.UUID
import kotlin.test.assertEquals

/**
 * Spec section 6 item 4: a token of shop A on any `shops/{B}/...` endpoint is 404, whether the
 * caller owns A, works in A or belongs to no shop at all, and the response is indistinguishable
 * from a shop that does not exist. Nothing in shop B changes.
 */
@IntegrationTest
class TenantIsolationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired auth: TestAuth,
    @Autowired private val jdbc: JdbcTemplate,
) {
    private val fixtures = TenancyFixtures(mvc, auth, jdbc)

    private fun endpointsOf(
        shopId: UUID,
        member: UUID,
    ): List<Pair<String, (String) -> ResultActionsDsl>> =
        listOf(
            "GET shops/{id}" to { bearer -> mvc.get("/v1/shops/$shopId") { header(AUTHORIZATION, bearer) } },
            "PATCH shops/{id}" to { bearer ->
                mvc.patch("/v1/shops/$shopId") {
                    header(AUTHORIZATION, bearer)
                    contentType = MediaType.APPLICATION_JSON
                    content = """{"name":"Ele geçirildi"}"""
                }
            },
            "POST shops/{id}/invitations" to { bearer ->
                mvc.post("/v1/shops/$shopId/invitations") {
                    header(AUTHORIZATION, bearer)
                    contentType = MediaType.APPLICATION_JSON
                    content = """{"phone":"${fixtures.actor().phone}"}"""
                }
            },
            "GET shops/{id}/members" to { bearer -> mvc.get("/v1/shops/$shopId/members") { header(AUTHORIZATION, bearer) } },
            "DELETE shops/{id}/members/{userId}" to { bearer ->
                mvc.delete("/v1/shops/$shopId/members/$member") { header(AUTHORIZATION, bearer) }
            },
        )

    @Test
    fun `members of shop A and users without a shop get 404 on every shop B endpoint`() {
        val shopA = fixtures.world()
        val shopB = fixtures.world()
        val loner = fixtures.actor()
        val nameBefore = fixtures.shopName(shopB.shopId)

        val callers = mapOf("owner of A" to shopA.owner, "staff of A" to shopA.staff, "user without a shop" to loner)
        callers.forEach { (who, caller) ->
            endpointsOf(shopB.shopId, shopB.staff.id).forEach { (endpoint, call) ->
                val body = call(caller.bearer).expectProblem(404, "not_found")
                assertEquals(notFoundShape(), withoutTraceId(body), "$who on $endpoint")
            }
        }

        assertEquals(nameBefore, fixtures.shopName(shopB.shopId))
        assertEquals("STAFF", fixtures.roleOf(shopB.shopId, shopB.staff.id))
        assertEquals(0, fixtures.invitationCount(shopB.shopId))
    }

    @Test
    fun `a shop of another tenant answers exactly like a shop that does not exist`() {
        val shopA = fixtures.world()
        val shopB = fixtures.world()
        val missing = UUID.randomUUID()
        endpointsOf(missing, shopB.staff.id).zip(endpointsOf(shopB.shopId, shopB.staff.id)).forEach { (unknown, foreign) ->
            val unknownBody = unknown.second(shopA.owner.bearer).expectProblem(404, "not_found")
            val foreignBody = foreign.second(shopA.owner.bearer).expectProblem(404, "not_found")
            assertEquals(withoutTraceId(unknownBody), withoutTraceId(foreignBody), unknown.first)
        }
    }

    @Test
    fun `a member id of another shop cannot be removed through the caller's own shop`() {
        val shopA = fixtures.world()
        val shopB = fixtures.world()
        mvc
            .delete("/v1/shops/${shopA.shopId}/members/${shopB.staff.id}") { header(AUTHORIZATION, shopA.owner.bearer) }
            .expectProblem(404, "not_found")
        assertEquals("STAFF", fixtures.roleOf(shopB.shopId, shopB.staff.id))
    }

    @Test
    fun `an invitation of shop B accepted by a phone it was not issued for is 404`() {
        val shopA = fixtures.world()
        val shopB = fixtures.world()
        val invited = fixtures.actor()
        val issued =
            mvc
                .post("/v1/shops/${shopB.shopId}/invitations") {
                    header(AUTHORIZATION, shopB.owner.bearer)
                    contentType = MediaType.APPLICATION_JSON
                    content = """{"phone":"${invited.phone}"}"""
                }.andExpect { status { isCreated() } }
                .andReturn()
                .response.contentAsString
        val code = JsonPath.read<String>(issued, "$.code")

        listOf(shopA.owner, shopA.staff, fixtures.actor()).forEach { stranger ->
            mvc.post("/v1/invitations/$code/accept") { header(AUTHORIZATION, stranger.bearer) }.expectProblem(404, "not_found")
            assertEquals(null, fixtures.roleOf(shopB.shopId, stranger.id))
        }

        // The rejected attempts did not consume the invitation.
        mvc.post("/v1/invitations/$code/accept") { header(AUTHORIZATION, invited.bearer) }.andExpect { status { isCreated() } }
        assertEquals("STAFF", fixtures.roleOf(shopB.shopId, invited.id))
    }

    @Test
    fun `membership is read on every request, so a removed member loses access at once`() {
        val shop = fixtures.world()
        mvc.get("/v1/shops/${shop.shopId}") { header(AUTHORIZATION, shop.staff.bearer) }.andExpect { status { isOk() } }
        mvc
            .delete("/v1/shops/${shop.shopId}/members/${shop.staff.id}") { header(AUTHORIZATION, shop.owner.bearer) }
            .andExpect { status { isNoContent() } }
        // Same token as before: only the membership row changed.
        mvc.get("/v1/shops/${shop.shopId}") { header(AUTHORIZATION, shop.staff.bearer) }.expectProblem(404, "not_found")
    }

    @Test
    fun `a deleted shop is gone for its own members`() {
        val shop = fixtures.world()
        jdbc.update("UPDATE shops SET deleted_at = now() WHERE id = ?", shop.shopId)
        mvc.get("/v1/shops/${shop.shopId}") { header(AUTHORIZATION, shop.owner.bearer) }.expectProblem(404, "not_found")
        mvc.get("/v1/shops/${shop.shopId}/members") { header(AUTHORIZATION, shop.owner.bearer) }.expectProblem(404, "not_found")
    }

    @Test
    fun `tenant endpoints require a token`() {
        val shop = fixtures.world()
        endpointsOf(shop.shopId, shop.staff.id).forEach { (endpoint, call) ->
            assertEquals(401, call("").andReturn().response.status, endpoint)
        }
        mvc.post("/v1/invitations/ABCDEFGH/accept").expectProblem(401, "auth.unauthenticated")
    }

    private fun notFoundShape(): Map<String, Any?> =
        mapOf("type" to "https://cetele.app/problems/not_found", "title" to "Not found", "status" to 404, "code" to "not_found")
}
