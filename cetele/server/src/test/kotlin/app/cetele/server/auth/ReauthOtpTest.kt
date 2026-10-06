package app.cetele.server.auth

import app.cetele.server.auth.otp.OtpCheck
import app.cetele.server.auth.otp.OtpPurpose
import app.cetele.server.auth.otp.OtpService
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestUsers
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertIs

@IntegrationTest
class ReauthOtpTest(
    @Autowired private val otp: OtpService,
    @Autowired private val tx: TransactionTemplate,
) {
    @Test
    fun `login and reauth can be open together and cannot replace each other`() {
        val phone = TestUsers.phone()
        val device = UUID.randomUUID()
        val now = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS)
        val login = issue(phone, device, OtpPurpose.LOGIN, now)
        var reauth = issue(phone, device, OtpPurpose.REAUTH, now.plusSeconds(1))
        // Avoid the one-in-a-million collision between independently sampled six-digit codes.
        while (login == reauth) reauth = issue(phone, device, OtpPurpose.REAUTH, now.plusSeconds(2))
        assertEquals(OtpCheck.Rejected, check(phone, device, OtpPurpose.LOGIN, reauth, now.plusSeconds(3)))
        assertEquals(OtpCheck.Rejected, check(phone, device, OtpPurpose.REAUTH, login, now.plusSeconds(3)))
        assertIs<OtpCheck.Accepted>(check(phone, device, OtpPurpose.LOGIN, login, now.plusSeconds(4)))
        assertIs<OtpCheck.Accepted>(check(phone, device, OtpPurpose.REAUTH, reauth, now.plusSeconds(4)))
        assertEquals(OtpCheck.Rejected, check(phone, device, OtpPurpose.REAUTH, reauth, now.plusSeconds(5)))
    }

    @Test
    fun `reauth expires at five minutes and closes on the fifth wrong attempt`() {
        val phone = TestUsers.phone()
        val device = UUID.randomUUID()
        val now = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS)
        val expired = issue(phone, device, OtpPurpose.REAUTH, now)
        assertEquals(OtpCheck.Rejected, check(phone, device, OtpPurpose.REAUTH, expired, now.plus(OtpService.TTL)))
        val exhausted = issue(phone, device, OtpPurpose.REAUTH, now.plusSeconds(1))
        repeat(
            5,
        ) { assertEquals(OtpCheck.Rejected, check(phone, device, OtpPurpose.REAUTH, AuthApi.otherCode(exhausted), now.plusSeconds(2))) }
        assertEquals(OtpCheck.Rejected, check(phone, device, OtpPurpose.REAUTH, exhausted, now.plusSeconds(3)))
        val usable = issue(phone, device, OtpPurpose.REAUTH, now.plusSeconds(4))
        repeat(
            4,
        ) { assertEquals(OtpCheck.Rejected, check(phone, device, OtpPurpose.REAUTH, AuthApi.otherCode(usable), now.plusSeconds(5))) }
        assertIs<OtpCheck.Accepted>(check(phone, device, OtpPurpose.REAUTH, usable, now.plusSeconds(6)))
    }

    private fun issue(
        phone: String,
        device: UUID,
        purpose: OtpPurpose,
        now: Instant,
    ): String = Regex("\\b\\d{6}\\b").find(tx.execute { otp.issue(phone, device, purpose, now) }!!)!!.value

    private fun check(
        phone: String,
        device: UUID,
        purpose: OtpPurpose,
        code: String,
        now: Instant,
    ): OtpCheck = tx.execute { otp.check(phone, device, purpose, code, now) }!!
}
