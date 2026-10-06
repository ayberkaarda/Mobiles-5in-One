package app.cetele.server.reminders.quota

import app.cetele.server.config.SmsLimitsProperties
import app.cetele.server.security.TraceIdFilter
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import app.cetele.server.tenancy.ShopLocks
import app.cetele.server.tenancy.TenancyFixtures
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import org.springframework.transaction.support.TransactionTemplate
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

@IntegrationTest
class DailyCapTest(
    @Autowired private val service: SmsQuotaService,
    @Autowired private val quotas: SmsQuotaRepository,
    @Autowired private val locks: ShopLocks,
    @Autowired private val sent: SmsSentRecordRepository,
    @Autowired private val index: SmsSentIndex,
    @Autowired private val transactions: org.springframework.transaction.PlatformTransactionManager,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired mvc: MockMvc,
    @Autowired auth: TestAuth,
) {
    private val fixtures = TenancyFixtures(mvc, auth, jdbc)

    @Test
    fun `daily count is global and includes queued, sent and unknown-outcome SMS requested inside the Istanbul day`() {
        val first = customer()
        val second = customer()
        val start = Instant.parse("2040-10-05T21:00:00Z")
        val now = start.plusSeconds(3600)
        reminder(first, "SMS", "SENT", start)
        reminder(second, "SMS", "DELIVERED", start.plusSeconds(1))
        reminder(first, "SMS", "UNDELIVERED", start.plusSeconds(2))
        reminder(first, "SMS", "SENT", start.minusSeconds(1))
        reminder(first, "SMS", "SENT", start.plusSeconds(86400))
        reminder(first, "SMS", "QUEUED", start.plusSeconds(3))
        reminder(first, "SMS", "FAILED", start.plusSeconds(4), "outcome_unknown")
        reminder(first, "SMS", "FAILED", start.plusSeconds(5), "sms.provider_failed")
        reminder(first, "WHATSAPP", "SENT", now)
        assertEquals(5, service.dailySent(now))
        service.requireDailyCap(now)
        val capped = SmsQuotaService(quotas, locks, sent, index, SmsLimitsProperties(dailyCap = 5))
        val failure =
            assertFailsWith<ProblemException> {
                TransactionTemplate(transactions).execute { capped.requireDailyCap(now) }
            }
        assertEquals(ProblemCode.SMS_DAILY_CAP_REACHED, failure.code)
        assertEquals(429, failure.code.status.value())
        assertEquals((86400 - 3600).toString(), failure.headers["Retry-After"])
    }

    @Test
    fun `daily cap resets exactly at Istanbul midnight with fractional retry rounding`() {
        val customer = customer()
        val start = Instant.parse("2041-10-05T21:00:00Z")
        reminder(customer, "SMS", "SENT", start)
        val capped = SmsQuotaService(quotas, locks, sent, index, SmsLimitsProperties(dailyCap = 1))
        val failure =
            assertFailsWith<ProblemException> {
                TransactionTemplate(transactions).execute { capped.requireDailyCap(start.plusMillis(86_399_500)) }
            }
        assertEquals("1", failure.headers["Retry-After"])
        assertEquals(0, service.dailySent(start.plusSeconds(86400)))
        TransactionTemplate(transactions).execute { capped.requireDailyCap(start.plusSeconds(86400)) }
    }

    private fun customer(): Pair<UUID, UUID> {
        val shop = fixtures.shop()
        val customer = TraceIdFilter.uuidV7()
        jdbc.update("INSERT INTO customers (id, shop_id, name) VALUES (?, ?, ?)", customer, shop, "Test Customer")
        return shop to customer
    }

    private fun reminder(
        customer: Pair<UUID, UUID>,
        channel: String,
        status: String,
        requestedAt: Instant,
        failureCode: String? = null,
    ) {
        jdbc.update(
            "INSERT INTO reminders (id, shop_id, customer_id, channel, template, status, requested_at, failure_code) VALUES (?, ?, ?, ?, 'BALANCE', ?, ?, ?)",
            TraceIdFilter.uuidV7(),
            customer.first,
            customer.second,
            channel,
            status,
            Timestamp.from(requestedAt),
            failureCode,
        )
    }
}
