package app.cetele.server.tenancy

import app.cetele.server.security.TraceIdFilter
import app.cetele.server.support.TestAuth
import app.cetele.server.support.TestUsers
import com.jayway.jsonpath.JsonPath
import org.springframework.http.HttpHeaders.AUTHORIZATION
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.ResultActionsDsl
import org.springframework.test.web.servlet.post
import java.util.UUID
import kotlin.test.assertEquals

/** A user of the test database with a ready `Authorization` header. */
data class Actor(
    val id: UUID,
    val phone: String,
    val bearer: String,
)

/** One shop with its owner and two staff members. */
data class ShopWorld(
    val shopId: UUID,
    val owner: Actor,
    val staff: Actor,
    val otherStaff: Actor,
)

/**
 * Builds tenancy fixtures. Shops are created through `POST /v1/shops` (so the owner membership is
 * the real one); staff rows are inserted directly, the invitation path has its own tests.
 */
class TenancyFixtures(
    private val mvc: MockMvc,
    private val auth: TestAuth,
    private val jdbc: JdbcTemplate,
) {
    fun actor(phone: String = TestUsers.phone()): Actor {
        val id = auth.user(phone)
        return Actor(id, phone, auth.bearer(id))
    }

    fun shop(
        owner: Actor = actor(),
        name: String = "Yıldız Bakkal",
    ): UUID {
        val body =
            mvc
                .post("/v1/shops") {
                    header(AUTHORIZATION, owner.bearer)
                    contentType = MediaType.APPLICATION_JSON
                    content = """{"name":"$name","type":"BAKKAL","il":"İstanbul","ilce":"Kadıköy"}"""
                }.andExpect { status { isCreated() } }
                .andReturn()
                .response.contentAsString
        return UUID.fromString(JsonPath.read<String>(body, "$.id"))
    }

    fun addStaff(
        shopId: UUID,
        member: Actor = actor(),
    ): Actor {
        jdbc.update(
            "INSERT INTO memberships (id, shop_id, user_id, role) VALUES (?, ?, ?, 'STAFF')",
            TraceIdFilter.uuidV7(),
            shopId,
            member.id,
        )
        return member
    }

    fun world(): ShopWorld {
        val owner = actor()
        val shopId = shop(owner)
        return ShopWorld(shopId, owner, addStaff(shopId), addStaff(shopId))
    }

    fun roleOf(
        shopId: UUID,
        userId: UUID,
    ): String? =
        jdbc
            .queryForList("SELECT role FROM memberships WHERE shop_id = ? AND user_id = ?", String::class.java, shopId, userId)
            .firstOrNull()

    fun shopName(shopId: UUID): String = jdbc.queryForObject("SELECT name FROM shops WHERE id = ?", String::class.java, shopId)!!

    fun invitationCount(shopId: UUID): Int =
        jdbc.queryForObject("SELECT count(*) FROM invitations WHERE shop_id = ?", Int::class.java, shopId)!!

    companion object {
        /** Asserts a registry problem response and returns its body. */
        fun ResultActionsDsl.expectProblem(
            status: Int,
            code: String,
        ): String {
            val response = andReturn().response
            assertEquals(status, response.status, "status for expected problem $code: ${response.contentAsString}")
            assertEquals(code, JsonPath.read<String>(response.contentAsString, "$.code"))
            assertEquals(MediaType.APPLICATION_PROBLEM_JSON_VALUE, response.contentType)
            return response.contentAsString
        }

        /** The problem body without its per-request trace id, for "identical response" checks. */
        fun withoutTraceId(body: String): Map<String, Any?> = JsonPath.read<Map<String, Any?>>(body, "$").filterKeys { it != "traceId" }
    }
}
