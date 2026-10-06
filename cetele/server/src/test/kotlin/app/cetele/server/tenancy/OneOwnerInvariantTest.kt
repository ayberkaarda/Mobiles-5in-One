package app.cetele.server.tenancy

import app.cetele.server.security.TraceIdFilter
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/** D-6: exactly one `OWNER` per shop, held by the database (`memberships_one_owner`). */
@IntegrationTest
class OneOwnerInvariantTest(
    @Autowired mvc: MockMvc,
    @Autowired auth: TestAuth,
    @Autowired private val jdbc: JdbcTemplate,
) {
    private val fixtures = TenancyFixtures(mvc, auth, jdbc)

    private fun insertMembership(
        shopId: UUID,
        userId: UUID,
        role: String,
    ) {
        jdbc.update(
            "INSERT INTO memberships (id, shop_id, user_id, role) VALUES (?, ?, ?, ?)",
            TraceIdFilter.uuidV7(),
            shopId,
            userId,
            role,
        )
    }

    @Test
    fun `creating a shop makes the caller its only owner`() {
        val owner = fixtures.actor()
        val shopId = fixtures.shop(owner)
        val owners = jdbc.queryForList("SELECT user_id FROM memberships WHERE shop_id = ? AND role = 'OWNER'", UUID::class.java, shopId)
        assertEquals(listOf(owner.id), owners)
        val createdBy = jdbc.queryForObject("SELECT created_by FROM shops WHERE id = ?", UUID::class.java, shopId)
        assertEquals(owner.id, createdBy)
    }

    @Test
    fun `a second owner row for the same shop is rejected by the database`() {
        val world = fixtures.world()
        assertFailsWith<DataIntegrityViolationException> { insertMembership(world.shopId, fixtures.actor().id, "OWNER") }
        assertFailsWith<DataIntegrityViolationException> {
            jdbc.update("UPDATE memberships SET role = 'OWNER' WHERE shop_id = ? AND user_id = ?", world.shopId, world.staff.id)
        }
        assertEquals("STAFF", fixtures.roleOf(world.shopId, world.staff.id))
    }

    @Test
    fun `one user may own several shops and staff rows are unrestricted`() {
        val owner = fixtures.actor()
        val first = fixtures.shop(owner)
        val second = fixtures.shop(owner)
        assertEquals("OWNER", fixtures.roleOf(first, owner.id))
        assertEquals("OWNER", fixtures.roleOf(second, owner.id))
        fixtures.addStaff(first)
        fixtures.addStaff(first)
        val staffCount =
            jdbc.queryForObject(
                "SELECT count(*) FROM memberships WHERE shop_id = ? AND role = 'STAFF'",
                Int::class.java,
                first,
            )
        assertEquals(2, staffCount)
    }
}
