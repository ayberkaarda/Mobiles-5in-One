package app.cetele.server.auth

import app.cetele.server.auth.token.RefreshTokenService
import app.cetele.server.reminders.sms.FakeSmsGateway
import app.cetele.server.reminders.sms.SmsGateway
import app.cetele.server.security.CurrentUser
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestUsers
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import tools.jackson.databind.ObjectMapper
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Rotation, reuse revocation and logout of one refresh family running at the same time. A
 * rotation is parked after it has written its successor token (the test holds the device row it
 * updates last), then the competing call is started and must wait; after the release no token of
 * the family may stay live when reuse or logout happened.
 */
@IntegrationTest
class RefreshRaceTest(
    @Autowired mvc: MockMvc,
    @Autowired json: ObjectMapper,
    @Autowired sms: SmsGateway,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired dataSource: DataSource,
    @Autowired private val auth: AuthService,
) {
    private val api = AuthApi(mvc, json, sms as FakeSmsGateway)
    private val race = DbRace(dataSource, jdbc)

    @AfterEach
    fun close() = race.close()

    @Test
    fun `a replayed old token during a rotation leaves no live token in the family`() {
        val session = rotatedSession()
        val rotation = parkedRotation(session)
        val replay = race.start { auth.refresh(session.oldToken, AuthApi.randomIp()) }
        race.awaitLockWaiters(2)
        race.releaseAll()

        assertTrue(race.result(rotation).isSuccess, "the in-flight rotation itself completes")
        assertRefreshInvalid(race.result(replay))
        assertEquals(0, liveTokens(session.familyId), "reuse detection must also revoke the successor written concurrently")
    }

    @Test
    fun `a logout during a rotation leaves no live token in the family`() {
        val session = rotatedSession()
        val rotation = parkedRotation(session)
        val logout = race.start { auth.logout(CurrentUser(session.userId, session.deviceId)) }
        race.awaitLockWaiters(2)
        race.releaseAll()

        assertTrue(race.result(rotation).isSuccess)
        assertTrue(race.result(logout).isSuccess)
        assertEquals(0, liveTokens(session.familyId), "logout must also revoke the successor written concurrently")
    }

    @Test
    fun `two concurrent refreshes of one token rotate once and then revoke the family`() {
        val session = rotatedSession()
        val first = parkedRotation(session)
        val second = race.start { auth.refresh(session.currentToken, AuthApi.randomIp()) }
        race.awaitLockWaiters(2)
        race.releaseAll()

        assertTrue(race.result(first).isSuccess)
        assertRefreshInvalid(race.result(second))
        assertEquals(0, liveTokens(session.familyId))
    }

    private data class Session(
        val userId: UUID,
        val deviceId: UUID,
        val familyId: UUID,
        val oldToken: String,
        val currentToken: String,
    )

    /** Signs in and rotates once, so the family has a revoked token and a live one. */
    private fun rotatedSession(): Session {
        val device = UUID.randomUUID()
        val first = api.signIn(TestUsers.phone(), device)["refreshToken"].asString()
        val current = api.read(api.refresh(first))["refreshToken"].asString()
        val row =
            jdbc.queryForMap("SELECT user_id, family_id FROM refresh_tokens WHERE token_hash = ?", RefreshTokenService.hash(current))
        return Session(row["user_id"] as UUID, device, row["family_id"] as UUID, first, current)
    }

    /** Starts a rotation of the live token and returns once it waits on the held device row. */
    private fun parkedRotation(session: Session) =
        race
            .apply {
                hold("SELECT id FROM devices WHERE user_id = ? AND device_id = ? FOR UPDATE", session.userId, session.deviceId)
            }.start { auth.refresh(session.currentToken, AuthApi.randomIp()) }
            .also { race.awaitLockWaiters(1) }

    private fun liveTokens(familyId: UUID): Int =
        jdbc.queryForObject("SELECT count(*) FROM refresh_tokens WHERE family_id = ? AND revoked_at IS NULL", Int::class.java, familyId)!!

    private fun assertRefreshInvalid(result: Result<*>) {
        val failure = result.exceptionOrNull()
        assertTrue(
            failure is ProblemException && failure.code == ProblemCode.AUTH_REFRESH_INVALID,
            "expected refresh_invalid, got $failure",
        )
    }
}
