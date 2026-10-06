package app.cetele.server.reminders.quota

import app.cetele.server.config.CeteleTime
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import app.cetele.server.tenancy.TenancyFixtures
import app.cetele.server.tenancy.shop.ShopPlan
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

@IntegrationTest
class SmsQuotaServiceTest(
    @Autowired private val service: SmsQuotaService,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val transactions: PlatformTransactionManager,
    @Autowired mvc: MockMvc,
    @Autowired auth: TestAuth,
) {
    private val fixtures = TenancyFixtures(mvc, auth, jdbc)

    @Test
    fun `a failed queue transaction does not consume a reservation`() {
        val shop = fixtures.shop()
        val now = Instant.parse("2026-10-15T12:00:00Z")
        TransactionTemplate(transactions).execute { status ->
            assertEquals(QuotaState("2026-10", 1, 30), service.reserve(shop, ShopPlan.FREE, now))
            status.setRollbackOnly()
        }
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM sms_quota WHERE shop_id = ?", Int::class.java, shop))
        assertEquals(QuotaState("2026-10", 1, 30), service.reserve(shop, ShopPlan.FREE, now))
    }

    @Test
    fun `the thirty first FREE reservation is rate limited until the next Istanbul month`() {
        val shop = fixtures.shop()
        val now = Instant.parse("2026-10-15T12:00:00Z")
        repeat(30) { assertEquals(QuotaState("2026-10", it + 1, 30), service.reserve(shop, ShopPlan.FREE, now)) }
        val failure = assertFailsWith<ProblemException> { service.reserve(shop, ShopPlan.FREE, now) }
        assertEquals(ProblemCode.SMS_QUOTA_EXCEEDED, failure.code)
        assertEquals(429, failure.code.status.value())
        val nextMonth = LocalDate.of(2026, 11, 1).atStartOfDay(CeteleTime.ZONE).toInstant()
        assertEquals(Duration.between(now, nextMonth).seconds.toString(), failure.headers["Retry-After"])
        assertEquals(30, used(shop, "2026-10-01"))
        service.refund(shop, "2026-10")
        assertEquals(29, used(shop, "2026-10-01"))
        assertEquals(QuotaState("2026-10", 30, 30), service.reserve(shop, ShopPlan.FREE, now))
    }

    @Test
    fun `refund never drops below zero and cannot touch another shop or month`() {
        val shop = fixtures.shop()
        val other = fixtures.shop()
        val now = Instant.parse("2026-10-15T12:00:00Z")
        service.reserve(shop, ShopPlan.FREE, now)
        service.reserve(other, ShopPlan.FREE, now)
        repeat(3) { service.refund(shop, LocalDate.of(2026, 10, 1)) }
        service.refund(shop, "2026-11")
        assertEquals(0, used(shop, "2026-10-01"))
        assertEquals(1, used(other, "2026-10-01"))
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM sms_quota WHERE shop_id = ?", Int::class.java, shop))
    }

    @Test
    fun `month rollover follows Istanbul midnight rather than UTC`() {
        val shop = fixtures.shop()
        val before = Instant.parse("2026-10-31T20:59:59Z")
        val after = before.plusSeconds(1)
        assertEquals(QuotaState("2026-10", 1, 30), service.reserve(shop, ShopPlan.FREE, before))
        assertEquals(QuotaState("2026-11", 1, 30), service.reserve(shop, ShopPlan.FREE, after))
        service.refund(shop, "2026-10")
        assertEquals(0, used(shop, "2026-10-01"))
        assertEquals(1, used(shop, "2026-11-01"))
    }

    @Test
    fun `PRO has five hundred slots and retry delay rounds fractional seconds up`() {
        val shop = fixtures.shop()
        val now = Instant.parse("2026-10-31T20:59:59.500Z")
        assertEquals(QuotaState("2026-10", 1, 500), service.reserve(shop, ShopPlan.PRO, now))
        jdbc.update("UPDATE sms_quota SET used = 500 WHERE shop_id = ? AND month = ?", shop, LocalDate.of(2026, 10, 1))
        val failure = assertFailsWith<ProblemException> { service.reserve(shop, ShopPlan.PRO, now) }
        assertEquals(ProblemCode.SMS_QUOTA_EXCEEDED, failure.code)
        assertEquals("1", failure.headers["Retry-After"])
    }

    @Test
    fun `sixteen threads reserve thirty distinct slots including concurrent first creation`() {
        val shop = fixtures.shop()
        val now = Instant.parse("2026-10-15T12:00:00Z")
        val executor = Executors.newFixedThreadPool(16)
        try {
            val results =
                executor
                    .invokeAll(
                        (1..64).map {
                            Callable {
                                try {
                                    service.reserve(shop, ShopPlan.FREE, now).used
                                } catch (failure: ProblemException) {
                                    assertEquals(ProblemCode.SMS_QUOTA_EXCEEDED, failure.code)
                                    null
                                }
                            }
                        },
                    ).map { it.get(30, TimeUnit.SECONDS) }
            assertEquals((1..30).toList(), results.filterNotNull().sorted())
            assertEquals(34, results.count { it == null })
            assertEquals(30, used(shop, "2026-10-01"))
            assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM sms_quota WHERE shop_id = ?", Int::class.java, shop))
        } finally {
            executor.shutdownNow()
        }
    }

    private fun used(
        shopId: java.util.UUID,
        month: String,
    ): Int =
        jdbc.queryForObject("SELECT used FROM sms_quota WHERE shop_id = ? AND month = ?", Int::class.java, shopId, LocalDate.parse(month))!!
}
