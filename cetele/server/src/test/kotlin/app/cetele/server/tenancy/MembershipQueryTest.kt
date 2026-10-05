package app.cetele.server.tenancy

import app.cetele.server.security.ShopRole
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import kotlin.test.assertEquals

/** The read API behind `GET /v1/me` memberships. */
@IntegrationTest
class MembershipQueryTest(
    @Autowired mvc: MockMvc,
    @Autowired auth: TestAuth,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val query: MembershipQuery,
) {
    private val fixtures = TenancyFixtures(mvc, auth, jdbc)

    @Test
    fun `lists only the caller's own memberships in live shops`() {
        val user = fixtures.actor()
        val owned = fixtures.shop(user)
        val other = fixtures.world()
        fixtures.addStaff(other.shopId, user)
        val deleted = fixtures.shop(user)
        jdbc.update("UPDATE shops SET deleted_at = now() WHERE id = ?", deleted)
        fixtures.world()

        assertEquals(
            setOf(MembershipSummary(owned, ShopRole.OWNER), MembershipSummary(other.shopId, ShopRole.STAFF)),
            query.membershipsOf(user.id).toSet(),
        )
        assertEquals(emptyList(), query.membershipsOf(fixtures.actor().id))
    }
}
