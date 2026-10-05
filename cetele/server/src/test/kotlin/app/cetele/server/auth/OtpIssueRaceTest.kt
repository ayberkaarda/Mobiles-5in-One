package app.cetele.server.auth

import app.cetele.server.auth.integrity.FakeIntegrityVerifier
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestUsers
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.jdbc.core.JdbcTemplate
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Two OTP requests for one phone at the same time must leave exactly one open code. */
@IntegrationTest
class OtpIssueRaceTest(
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired dataSource: DataSource,
    @Autowired private val auth: AuthService,
) {
    private val race = DbRace(dataSource, jdbc)

    @AfterEach
    fun close() = race.close()

    @Test
    fun `concurrent requests for one phone leave exactly one open code`() {
        val phone = TestUsers.phone()
        val device = UUID.randomUUID()
        auth.requestOtp(phone, device, FakeIntegrityVerifier.OK, AuthApi.randomIp())

        // Both requests park on the existing open code while closing it.
        race.hold("SELECT id FROM otp_codes WHERE phone_e164 = ? AND consumed_at IS NULL FOR UPDATE", phone)
        val first = race.start { auth.requestOtp(phone, device, FakeIntegrityVerifier.OK, AuthApi.randomIp()) }
        race.awaitLockWaiters(1)
        val second = race.start { auth.requestOtp(phone, device, FakeIntegrityVerifier.OK, AuthApi.randomIp()) }
        race.awaitLockWaiters(2)
        race.releaseAll()

        assertTrue(race.result(first).isSuccess)
        assertTrue(race.result(second).isSuccess)
        val open =
            jdbc.queryForObject("SELECT count(*) FROM otp_codes WHERE phone_e164 = ? AND consumed_at IS NULL", Int::class.java, phone)
        assertEquals(1, open, "an older code must never stay usable next to the newest one")
    }
}
