package app.cetele.server.tenancy

import app.cetele.server.account.AccountStore
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import org.springframework.transaction.support.TransactionTemplate
import java.sql.Timestamp
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@IntegrationTest
class TenancyFixturesTest(
    @Autowired mvc: MockMvc,
    @Autowired auth: TestAuth,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val tx: TransactionTemplate,
    @Autowired private val store: AccountStore,
) {
    private val fixtures = TenancyFixtures(mvc, auth, jdbc)

    @ParameterizedTest
    @ValueSource(ints = [-1, 1])
    fun `staff creation uses the JVM clock despite a different database default`(offsetDays: Int) {
        val owner = fixtures.actor()
        val shopId = fixtures.shop(owner)
        val staff = fixtures.actor()
        tx.executeWithoutResult { status ->
            status.setRollbackOnly()
            jdbc.execute("ALTER TABLE memberships ALTER COLUMN created_at SET DEFAULT (now() + interval '$offsetDays days')")
            val before = Instant.now().truncatedTo(ChronoUnit.MICROS)
            assertEquals(staff, fixtures.addStaff(shopId, staff))
            val after = Instant.now().plus(1, ChronoUnit.MICROS)
            val stored =
                jdbc.queryForObject(
                    "SELECT created_at FROM memberships WHERE shop_id = ? AND user_id = ?",
                    Timestamp::class.java,
                    shopId,
                    staff.id,
                )
            val createdAt = checkNotNull(stored).toInstant()
            assertFalse(createdAt.isBefore(before))
            assertFalse(createdAt.isAfter(after))
            assertTrue(store.joinedAfter(shopId, owner.id, before.minusSeconds(1)))
            assertFalse(store.joinedAfter(shopId, owner.id, after))
        }
    }
}
