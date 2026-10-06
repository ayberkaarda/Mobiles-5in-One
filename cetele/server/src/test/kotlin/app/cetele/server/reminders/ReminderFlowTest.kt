package app.cetele.server.reminders

import app.cetele.server.config.CeteleTime
import app.cetele.server.config.SmsLimitsProperties
import app.cetele.server.ledger.LedgerFixtures
import app.cetele.server.ledger.customer.CustomerRepository
import app.cetele.server.ledger.entry.LedgerEntryRepository
import app.cetele.server.ledger.money.MoneyFormat
import app.cetele.server.reminders.quota.SmsQuotaRepository
import app.cetele.server.reminders.quota.SmsQuotaService
import app.cetele.server.reminders.quota.SmsSentIndex
import app.cetele.server.reminders.quota.SmsSentRecordRepository
import app.cetele.server.reminders.sms.FakeSmsGateway
import app.cetele.server.reminders.sms.SmsGateway
import app.cetele.server.reminders.sms.SmsKind
import app.cetele.server.reminders.sms.SmsMessage
import app.cetele.server.reminders.sms.SmsSendResult
import app.cetele.server.security.TraceIdFilter
import app.cetele.server.statements.link.StatementLinkService
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import app.cetele.server.support.TestUsers
import app.cetele.server.tenancy.Actor
import app.cetele.server.tenancy.ShopLocks
import app.cetele.server.tenancy.TenancyFixtures
import app.cetele.server.tenancy.TenancyFixtures.Companion.expectProblem
import app.cetele.server.tenancy.shop.ShopRepository
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import com.jayway.jsonpath.JsonPath
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpHeaders.AUTHORIZATION
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.post
import org.springframework.transaction.PlatformTransactionManager
import java.time.Clock
import java.time.Instant
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@IntegrationTest
class ReminderFlowTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val auth: TestAuth,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val gateway: SmsGateway,
    @Autowired private val links: StatementLinkService,
    @Autowired private val quotas: SmsQuotaService,
    @Autowired private val clock: Clock,
    @Autowired private val quotaRows: SmsQuotaRepository,
    @Autowired private val locks: ShopLocks,
    @Autowired private val sent: SmsSentRecordRepository,
    @Autowired private val sentIndex: SmsSentIndex,
    @Autowired private val reminders: ReminderRepository,
    @Autowired private val customers: CustomerRepository,
    @Autowired private val entries: LedgerEntryRepository,
    @Autowired private val shops: ShopRepository,
    @Autowired private val transactions: PlatformTransactionManager,
) {
    @Test
    fun `accepted reminder stores delivery metadata and sends a usable statement link`() {
        val f = ReminderFixtures(mvc, auth, jdbc)
        val phone = TestUsers.phone()
        val customer = f.ledger.customer(f.shopId, name = "ReminderCustomer", phone = phone, smsConsent = true)
        val debt = f.ledger.entry(f.shopId, customer, amountMinor = 125_000L)
        f.ledger.entry(f.shopId, customer, type = "PAYMENT", amountMinor = 25_000L)
        f.ledger.entry(f.shopId, customer, amountMinor = 125_000L, reverses = debt)
        f.ledger.entry(f.shopId, customer, amountMinor = 50_000L)
        val body =
            f
                .send(customer)
                .andExpect { status { isCreated() } }
                .andReturn()
                .response.contentAsString
        val id = UUID.fromString(JsonPath.read<String>(body, "$.reminderId"))
        assertEquals(7, id.version())
        assertEquals("SENT", JsonPath.read<String>(body, "$.status"))
        assertEquals(1, JsonPath.read<Int>(body, "$.quota.used"))
        assertEquals(30, JsonPath.read<Int>(body, "$.quota.limit"))
        assertEquals(CeteleTime.monthStart(clock).toString().take(7), JsonPath.read<String>(body, "$.quota.month"))
        val sentAt = Instant.parse(JsonPath.read<String>(body, "$.sentAt"))
        val message = assertNotNull((gateway as FakeSmsGateway).lastMessageTo(phone))
        assertEquals(SmsKind.REMINDER, message.kind)
        assertTrue(message.text.contains("ReminderCustomer"))
        assertTrue(message.text.contains(f.tenancy.shopName(f.shopId)))
        assertTrue(message.text.contains(MoneyFormat.format(25_000L)))
        val token = message.text.substringAfterLast("/s/")
        val resolved = assertNotNull(links.resolve(token, clock.instant()))
        assertEquals(customer, resolved.customerId)
        assertEquals(f.shopId, resolved.shopId)
        val row = jdbc.queryForMap("SELECT * FROM reminders WHERE shop_id = ? AND id = ?", f.shopId, id)
        assertEquals("SENT", row["status"])
        assertEquals(resolved.id, row["statement_link_id"])
        assertEquals(f.owner.id, row["requested_by"])
        assertEquals(JsonPath.read<String>(body, "$.providerMessageId"), row["provider_msg_id"])
        val storedSentAt = (row["sent_at"] as java.sql.Timestamp).toInstant()
        assertTrue(
            kotlin.math.abs(
                java.time.Duration
                    .between(sentAt, storedSentAt)
                    .toNanos(),
            ) < 1_000,
        )
        assertEquals(null, row["failure_code"])
    }

    @Test
    fun `eligibility failures have exact codes and no side effects`() {
        val f = ReminderFixtures(mvc, auth, jdbc)
        val noPhone = f.ledger.customer(f.shopId, phone = null, smsConsent = true)
        val noConsent = f.ledger.customer(f.shopId)
        val zero = f.ledger.customer(f.shopId, smsConsent = true)
        val negative = f.ledger.customer(f.shopId, smsConsent = true)
        f.ledger.entry(f.shopId, negative, type = "PAYMENT")
        val deleted = f.customer()
        f.ledger.deleteCustomer(f.shopId, deleted)
        val other = ReminderFixtures(mvc, auth, jdbc)
        listOf(
            Triple(noPhone, 409, "sms.phone_missing"),
            Triple(noConsent, 409, "sms.consent_missing"),
            Triple(zero, 409, "reminder.no_balance"),
            Triple(negative, 409, "reminder.no_balance"),
            Triple(deleted, 404, "not_found"),
            Triple(other.customer(), 404, "not_found"),
            Triple(UUID.randomUUID(), 404, "not_found"),
        ).forEach { (customer, status, code) -> f.send(customer).expectProblem(status, code) }
        assertEquals(0, f.count("reminders"))
        assertEquals(0, f.count("statement_links"))
        assertEquals(0, f.count("sms_quota"))
    }

    @Test
    fun `unsupported channel template and unknown fields are rejected`() {
        val f = ReminderFixtures(mvc, auth, jdbc)
        val customer = f.customer()
        listOf("channel" to "WHATSAPP", "template" to "DUE_TODAY").forEach { (field, value) ->
            val response =
                f.send(
                    customer,
                    channel =
                        if (field ==
                            "channel"
                        ) {
                            value
                        } else {
                            "SMS"
                        },
                    template = if (field == "template") value else "BALANCE",
                )
            val body = response.expectProblem(422, "validation.failed")
            assertEquals(field, JsonPath.read<String>(body, "$.errors[0].field"))
            assertEquals("out_of_range", JsonPath.read<String>(body, "$.errors[0].code"))
        }
        mvc
            .post("/v1/shops/${f.shopId}/reminders") {
                header(AUTHORIZATION, f.owner.bearer)
                contentType = MediaType.APPLICATION_JSON
                content = """{"customerId":"$customer","channel":"SMS","template":"BALANCE","phone":"ignored"}"""
            }.expectProblem(422, "validation.failed")
        assertEquals(0, f.count("reminders"))
    }

    @Test
    fun `thirty first free reminder exceeds quota with a retry header`() {
        val f = ReminderFixtures(mvc, auth, jdbc)
        repeat(30) { f.send(f.customer()).andExpect { status { isCreated() } } }
        val staff = f.tenancy.addStaff(f.shopId)
        val response = f.send(f.customer(), actor = staff)
        response.expectProblem(429, "sms.quota_exceeded")
        assertTrue(
            response
                .andReturn()
                .response
                .getHeader("Retry-After")!!
                .toLong() > 0,
        )
        assertEquals(30, f.used())
        assertEquals(30, f.count("reminders"))
        assertEquals(30, f.count("statement_links"))
    }

    @Test
    fun `unknown outcome commits failure, keeps quota used and answers bad gateway`() {
        val f = ReminderFixtures(mvc, auth, jdbc)
        val customer = f.customer()
        (gateway as FakeSmsGateway).failNextSend("SensitiveProviderFailure")
        f.send(customer).expectProblem(502, "sms.provider_failed")
        // Failed = unknown outcome (timeout, transport, 5xx): the SMS may have gone out, so the slot stays used.
        assertEquals(1, f.used())
        val row = jdbc.queryForMap("SELECT * FROM reminders WHERE shop_id = ?", f.shopId)
        assertEquals("FAILED", row["status"])
        assertEquals("outcome_unknown", row["failure_code"])
        assertEquals(null, row["sent_at"])
        assertEquals(null, row["provider_msg_id"])
        f.send(customer).andExpect { status { isCreated() } }
        assertEquals(2, f.used())
    }

    @Test
    fun `definitive provider rejection refunds quota and stays out of the daily count`() {
        val f = ReminderFixtures(mvc, auth, jdbc)
        val customer = f.customer()
        val rejecting =
            object : SmsGateway {
                override fun send(message: SmsMessage): SmsSendResult = SmsSendResult.Rejected("invalid_sender")

                override fun balance() = gateway.balance()
            }
        val service = ReminderService(reminders, customers, entries, shops, quotas, links, rejecting, clock, transactions)
        val before = quotas.dailySent(clock.instant())
        val failure =
            assertFailsWith<ProblemException> {
                service.send(f.shopId, f.owner.id, ReminderRequest(customer, "SMS", "BALANCE"))
            }
        assertEquals(ProblemCode.SMS_PROVIDER_FAILED, failure.code)
        assertEquals(0, f.used())
        val row = jdbc.queryForMap("SELECT * FROM reminders WHERE shop_id = ?", f.shopId)
        assertEquals("FAILED", row["status"])
        assertEquals("sms.provider_failed", row["failure_code"])
        assertEquals(before, quotas.dailySent(clock.instant()))
    }

    @Test
    fun `unknown outcome keeps counting toward the daily cap`() {
        val f = ReminderFixtures(mvc, auth, jdbc)
        val before = quotas.dailySent(clock.instant())
        (gateway as FakeSmsGateway).failNextSend("timeout")
        f.send(f.customer()).expectProblem(502, "sms.provider_failed")
        assertEquals(before + 1, quotas.dailySent(clock.instant()))
    }

    @Test
    fun `concurrent requests at cap minus one produce exactly one send`() {
        val fixtures = List(6) { ReminderFixtures(mvc, auth, jdbc) }
        val targets = fixtures.map { it to it.customer() }
        val sends = AtomicInteger()
        val counting =
            object : SmsGateway {
                override fun send(message: SmsMessage): SmsSendResult = SmsSendResult.Accepted("cap-${sends.incrementAndGet()}")

                override fun balance() = gateway.balance()
            }
        val cap = quotas.dailySent(clock.instant()) + 1
        val cappedQuota = SmsQuotaService(quotaRows, locks, sent, sentIndex, SmsLimitsProperties(dailyCap = cap))
        val service = ReminderService(reminders, customers, entries, shops, cappedQuota, links, counting, clock, transactions)
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(targets.size)
        try {
            val futures =
                targets.map { (f, customer) ->
                    pool.submit<Throwable?> {
                        start.await()
                        runCatching { service.send(f.shopId, f.owner.id, ReminderRequest(customer, "SMS", "BALANCE")) }.exceptionOrNull()
                    }
                }
            start.countDown()
            val results = futures.map { it.get(60, TimeUnit.SECONDS) }
            assertEquals(1, results.count { it == null })
            assertTrue(results.filterNotNull().all { it is ProblemException && it.code == ProblemCode.SMS_DAILY_CAP_REACHED })
            assertEquals(1, sends.get())
        } finally {
            pool.shutdownNow()
            // Move the spent rows out of today so other tests keep a clean daily count.
            fixtures.forEach {
                jdbc.update(
                    "UPDATE reminders SET requested_at = ? WHERE shop_id = ?",
                    java.sql.Timestamp.from(clock.instant().minusSeconds(172800)),
                    it.shopId,
                )
            }
        }
    }

    @Test
    fun `link limit rolls back reservation and does not send`() {
        val f = ReminderFixtures(mvc, auth, jdbc)
        val customer = f.customer()
        repeat(20) { links.issue(f.shopId, customer, f.owner.id, now = clock.instant()) }
        f.send(customer).expectProblem(409, "statement.link_limit")
        assertEquals(0, f.count("sms_quota"))
        assertEquals(0, f.count("reminders"))
    }

    @Test
    fun `lowered global daily cap blocks sends across shops`() {
        val f = ReminderFixtures(mvc, auth, jdbc)
        val customer = f.customer()
        val now = clock.instant()
        val remaining = 100 - quotas.dailySent(now)
        assertTrue(remaining >= 0)
        repeat(remaining) {
            jdbc.update(
                "INSERT INTO reminders (id, shop_id, customer_id, channel, template, status, sent_at, requested_at) VALUES (?, ?, ?, 'SMS', 'BALANCE', 'SENT', ?, ?)",
                TraceIdFilter.uuidV7(),
                f.shopId,
                customer,
                java.sql.Timestamp.from(now),
                java.sql.Timestamp.from(now),
            )
        }
        try {
            assertEquals(100, quotas.dailySent(now))
            val other = ReminderFixtures(mvc, auth, jdbc)
            val cappedQuota = SmsQuotaService(quotaRows, locks, sent, sentIndex, SmsLimitsProperties(dailyCap = 100))
            val capped = ReminderService(reminders, customers, entries, shops, cappedQuota, links, gateway, clock, transactions)
            val failure =
                assertFailsWith<ProblemException> {
                    capped.send(other.shopId, other.owner.id, ReminderRequest(other.customer(), "SMS", "BALANCE"))
                }
            assertEquals(ProblemCode.SMS_DAILY_CAP_REACHED, failure.code)
            assertEquals(429, failure.code.status.value())
            assertTrue(failure.headers["Retry-After"]!!.toLong() > 0)
            assertEquals(0, other.count("reminders"))
            assertEquals(0, other.count("sms_quota"))
        } finally {
            jdbc.update(
                "UPDATE reminders SET requested_at = ? WHERE shop_id = ?",
                java.sql.Timestamp.from(now.minusSeconds(172800)),
                f.shopId,
            )
        }
    }
}

internal class ReminderFixtures(
    private val mvc: MockMvc,
    auth: TestAuth,
    private val jdbc: JdbcTemplate,
) {
    val tenancy = TenancyFixtures(mvc, auth, jdbc)
    val owner = tenancy.actor()
    val shopId = tenancy.shop(owner)
    val ledger = LedgerFixtures(jdbc)

    fun customer(): UUID = ledger.customer(shopId, smsConsent = true).also { ledger.entry(shopId, it) }

    fun send(
        customerId: UUID,
        actor: Actor = owner,
        channel: String = "SMS",
        template: String = "BALANCE",
    ) = mvc.post("/v1/shops/$shopId/reminders") {
        header(AUTHORIZATION, actor.bearer)
        contentType = MediaType.APPLICATION_JSON
        content = """{"customerId":"$customerId","channel":"$channel","template":"$template"}"""
    }

    fun count(table: String): Int {
        require(table in setOf("reminders", "statement_links", "sms_quota"))
        return jdbc.queryForObject("SELECT count(*) FROM $table WHERE shop_id = ?", Int::class.java, shopId)!!
    }

    fun used(): Int = jdbc.queryForObject("SELECT used FROM sms_quota WHERE shop_id = ?", Int::class.java, shopId)!!
}
