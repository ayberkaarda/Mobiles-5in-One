package app.cetele.server.statements.link

import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import app.cetele.server.tenancy.TenancyFixtures
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import java.time.Duration
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

@IntegrationTest
class StatementLinkServiceTest(
    @Autowired private val service: StatementLinkService,
    @Autowired private val hasher: StatementLinkHasher,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired mvc: MockMvc,
    @Autowired auth: TestAuth,
) {
    private val fixtures = TenancyFixtures(mvc, auth, jdbc)

    @Test
    fun `link token is returned once and only its hash is stored`() {
        val (shop, customer) = customer()
        val now = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS)
        val issued = service.issue(shop, customer, null, now = now)
        assertEquals(43, issued.token.length)
        assertTrue(issued.token.matches(Regex("[A-Za-z0-9_-]{43}")))
        assertEquals("http://localhost/s/${issued.token}", issued.url)
        assertEquals(now.plus(Duration.ofDays(30)), issued.expiresAt)
        val row = jdbc.queryForMap("SELECT * FROM statement_links WHERE id = ?", issued.id)
        assertEquals(hasher.hash(issued.token), row["token_hash"])
        assertFalse(row.values.any { it.toString().contains(issued.token) })
        assertEquals(ResolvedLink(issued.id, shop, customer), service.resolve(issued.token, now))
        assertNull(service.resolve(issued.token, issued.expiresAt))
        assertNull(service.resolve("short", now))
        val unknown =
            java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(
                ByteArray(32).also(java.security.SecureRandom()::nextBytes),
            )
        assertNull(service.resolve(unknown, now))
    }

    @Test
    fun `opening tracks time and count and revocation is scoped by customer and shop`() {
        val (shop, customer) = customer()
        val (otherShop, otherCustomer) = customer()
        val now = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS)
        val first = service.issue(shop, customer, null, now = now)
        val second = service.issue(otherShop, otherCustomer, null, now = now)
        repeat(3) { service.markOpened(first.id, now.plusSeconds(it.toLong())) }
        assertEquals(3, jdbc.queryForObject("SELECT open_count FROM statement_links WHERE id = ?", Int::class.java, first.id))
        assertNotNull(jdbc.queryForObject("SELECT opened_at FROM statement_links WHERE id = ?", java.sql.Timestamp::class.java, first.id))
        service.revokeForCustomer(otherShop, customer, now)
        assertNotNull(service.resolve(first.token, now))
        service.revokeForCustomer(shop, customer, now)
        assertNull(service.resolve(first.token, now))
        assertNotNull(service.resolve(second.token, now))
        service.markOpened(first.id, now.plusSeconds(4))
        assertEquals(3, jdbc.queryForObject("SELECT open_count FROM statement_links WHERE id = ?", Int::class.java, first.id))
    }

    @Test
    fun `twenty open links are allowed and expired or revoked links free a slot`() {
        val (shop, customer) = customer()
        val now = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS)
        val issued = (1..20).map { service.issue(shop, customer, null, now = now) }
        val failure = assertFailsWith<ProblemException> { service.issue(shop, customer, null, now = now) }
        assertEquals(ProblemCode.STATEMENT_LINK_LIMIT, failure.code)
        assertNotNull(service.issue(shop, customer, null, now = issued.first().expiresAt))
        service.revokeForCustomer(shop, customer, issued.first().expiresAt)
        assertNotNull(service.issue(shop, customer, null, now = issued.first().expiresAt))
    }

    private fun customer(): Pair<UUID, UUID> {
        val shop = fixtures.shop()
        val customer = UUID.randomUUID()
        jdbc.update("INSERT INTO customers (id, shop_id, name) VALUES (?, ?, 'Customer')", customer, shop)
        return shop to customer
    }

    @Test
    fun `concurrent issuance never exceeds twenty open links and opens are not lost`() {
        val (shop, customer) = customer()
        val now = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS)
        val executor = Executors.newFixedThreadPool(8)
        try {
            val results =
                executor
                    .invokeAll(
                        (1..32).map {
                            Callable {
                                try {
                                    service.issue(shop, customer, null, now = now)
                                    true
                                } catch (failure: ProblemException) {
                                    assertEquals(ProblemCode.STATEMENT_LINK_LIMIT, failure.code)
                                    false
                                }
                            }
                        },
                    ).map { it.get(30, TimeUnit.SECONDS) }
            assertEquals(20, results.count { it })
            val id = jdbc.queryForList("SELECT id FROM statement_links WHERE shop_id = ?", UUID::class.java, shop).first()!!
            executor.invokeAll((1..32).map { Callable { service.markOpened(id, now) } }).forEach { it.get(30, TimeUnit.SECONDS) }
            assertEquals(
                32,
                jdbc.queryForObject("SELECT open_count FROM statement_links WHERE shop_id = ? AND id = ?", Int::class.java, shop, id),
            )
        } finally {
            executor.shutdownNow()
        }
    }
}
