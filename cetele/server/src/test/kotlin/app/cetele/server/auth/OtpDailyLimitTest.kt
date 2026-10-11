package app.cetele.server.auth

import app.cetele.server.account.AccountStore
import app.cetele.server.account.ReauthAction
import app.cetele.server.account.ReauthVerifier
import app.cetele.server.auth.otp.OtpCheck
import app.cetele.server.auth.otp.OtpConfiguration
import app.cetele.server.auth.otp.OtpPurpose
import app.cetele.server.auth.otp.OtpService
import app.cetele.server.auth.ratelimit.RateLimiter
import app.cetele.server.reminders.sms.FakeSmsGateway
import app.cetele.server.security.CurrentUser
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import app.cetele.server.support.TestUsers
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.EnumSource
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.mock.env.MockEnvironment
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertTrue

@IntegrationTest
class OtpDailyLimitTest(
    @Autowired private val otp: OtpService,
    @Autowired private val tx: TransactionTemplate,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val sms: FakeSmsGateway,
    @Autowired private val users: UserStore,
    @Autowired private val store: AccountStore,
    @Autowired private val auth: TestAuth,
    @Autowired private val manager: PlatformTransactionManager,
    @Autowired private val dataSource: DataSource,
) {
    private val start = Instant.parse("2026-10-10T00:00:00Z")

    @ParameterizedTest
    @EnumSource(OtpPurpose::class)
    fun `rolling ceiling counts consumed expired and exhausted codes and releases at boundary`(purpose: OtpPurpose) {
        val phone = TestUsers.phone()
        val device = UUID.randomUUID()
        val scope = scope(purpose)
        repeat(10) { index ->
            val now = Clock.fixed(start.plus(Duration.ofHours(index.toLong())), ZoneOffset.UTC).instant()
            val text = issue(phone, device, purpose, now)
            val value = Regex("[0-9]{6}").find(text)!!.value
            when (index % 3) {
                0 -> {
                    assertIs<OtpCheck.Accepted>(tx.execute { otp.check(phone, device, purpose, value, now, scope) })
                }

                1 -> {
                    repeat(5) {
                        assertEquals(
                            OtpCheck.Rejected,
                            tx.execute { otp.check(phone, device, purpose, AuthApi.otherCode(value), now, scope) },
                        )
                    }
                }

                else -> {
                    // Left unused until it expires: an untouched code still spends the daily budget.
                }
            }
        }
        val error = assertFailsWith<ProblemException> { issue(phone, device, purpose, start.plus(Duration.ofHours(23))) }
        assertEquals(ProblemCode.RATE_LIMITED, error.code)
        assertEquals("3600", error.headers["Retry-After"])
        assertEquals(10, sms.messagesTo(phone).size)
        issue(phone, device, purpose, start.plus(Duration.ofHours(24)))
        assertEquals(11, sms.messagesTo(phone).size)
    }

    @Test
    fun `purposes have independent daily ceilings`() {
        val phone = TestUsers.phone()
        val device = UUID.randomUUID()
        repeat(10) { issue(phone, device, OtpPurpose.REAUTH, start.plusSeconds(it.toLong())) }
        issue(phone, device, OtpPurpose.LOGIN, start.plusSeconds(10))
        repeat(9) { issue(phone, device, OtpPurpose.LOGIN, start.plusSeconds(11 + it.toLong())) }
        OtpPurpose.entries.forEach { purpose ->
            assertEquals(
                ProblemCode.RATE_LIMITED,
                assertFailsWith<ProblemException> { issue(phone, device, purpose, start.plusSeconds(30)) }.code,
            )
        }
        assertEquals(20, sms.messagesTo(phone).size)
    }

    @Test
    fun `reauth daily ceiling survives replacement of the in memory limiter`() {
        val phone = TestUsers.phone()
        val caller = CurrentUser(auth.user(phone), UUID.randomUUID())

        fun verifier(now: Instant) = ReauthVerifier(users, store, otp, RateLimiter(), manager, Clock.fixed(now, ZoneOffset.UTC))

        repeat(10) { verifier(start.plus(Duration.ofHours(it.toLong()))).request(caller, ReauthAction.ACCOUNT_DELETE) }
        val error =
            assertFailsWith<ProblemException> {
                verifier(start.plus(Duration.ofHours(23))).request(caller, ReauthAction.ACCOUNT_DELETE)
            }
        assertEquals(ProblemCode.RATE_LIMITED, error.code)
        assertEquals("3600", error.headers["Retry-After"])
        assertEquals(10, sms.messagesTo(phone).size)
        verifier(start.plus(Duration.ofHours(24))).request(caller, ReauthAction.ACCOUNT_DELETE)
        assertEquals(11, sms.messagesTo(phone).size)
    }

    @Test
    fun `daily refusal preserves newest code and rounds fractional retry upward`() {
        val phone = TestUsers.phone()
        val device = UUID.randomUUID()
        var text = ""
        repeat(10) { text = issue(phone, device, OtpPurpose.LOGIN, start) }
        val value = Regex("[0-9]{6}").find(text)!!.value
        val error = assertFailsWith<ProblemException> { issue(phone, device, OtpPurpose.LOGIN, start.plusNanos(1)) }
        assertEquals("86400", error.headers["Retry-After"])
        assertIs<OtpCheck.Accepted>(tx.execute { otp.check(phone, device, OtpPurpose.LOGIN, value, start.plusSeconds(1)) })
        assertEquals(10, sms.messagesTo(phone).size)
    }

    @Test
    fun `daily settings default to ten accept overrides and reject nonpositive values`() {
        val settings = OtpConfiguration()
        assertEquals(10, settings.otpSettings(MockEnvironment()).dailyLimit)
        assertEquals(3, settings.otpSettings(MockEnvironment().withProperty("cetele.otp.daily-limit", "3")).dailyLimit)
        listOf("0", "-1").forEach { value ->
            assertFailsWith<IllegalArgumentException> {
                settings.otpSettings(MockEnvironment().withProperty("cetele.otp.daily-limit", value))
            }
        }
    }

    @ParameterizedTest
    @EnumSource(OtpPurpose::class)
    fun `simultaneous tenth and eleventh requests cannot exceed daily ceiling`(purpose: OtpPurpose) {
        val phone = TestUsers.phone()
        val device = UUID.randomUUID()
        repeat(9) { issue(phone, device, purpose, start.plusSeconds(it.toLong())) }
        DbRace(dataSource, jdbc).use { race ->
            race.hold("SELECT id FROM otp_codes WHERE phone_e164 = ? AND consumed_at IS NULL FOR UPDATE", phone)
            val first = race.start { issue(phone, device, purpose, start.plusSeconds(10)) }
            race.awaitLockWaiters(1)
            val second = race.start { issue(phone, device, purpose, start.plusSeconds(11)) }
            race.awaitLockWaiters(2)
            race.releaseAll()
            val outcomes = listOf(race.result(first), race.result(second))
            assertEquals(1, outcomes.count { it.isSuccess })
            assertEquals(ProblemCode.RATE_LIMITED, assertIs<ProblemException>(outcomes.single { it.isFailure }.exceptionOrNull()).code)
        }
        assertEquals(10, jdbc.queryForObject("SELECT count(*) FROM otp_codes WHERE phone_e164 = ?", Int::class.java, phone))
        assertEquals(10, sms.messagesTo(phone).size)
        assertTrue(sms.messagesTo(phone).all { it.text.contains("Çetele") })
    }

    private fun issue(
        phone: String,
        device: UUID,
        purpose: OtpPurpose,
        now: Instant,
    ): String {
        val text = checkNotNull(tx.execute { otp.issue(phone, device, purpose, now, scope(purpose)) })
        otp.deliver(phone, text)
        return text
    }

    private fun scope(purpose: OtpPurpose): String? = if (purpose == OtpPurpose.REAUTH) ReauthAction.ACCOUNT_DELETE.scope() else null
}
