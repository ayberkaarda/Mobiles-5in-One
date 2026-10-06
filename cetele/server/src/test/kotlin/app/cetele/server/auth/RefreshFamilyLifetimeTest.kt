package app.cetele.server.auth

import app.cetele.server.auth.token.RefreshTokenService
import app.cetele.server.auth.token.RotationResult
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.post
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull

@IntegrationTest
class RefreshFamilyLifetimeTest(
    @Autowired private val tokens: RefreshTokenService,
    @Autowired private val tx: TransactionTemplate,
    @Autowired private val auth: TestAuth,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val mvc: MockMvc,
) {
    @Test
    fun `rotations share the fixed family end and shorten the final token`() {
        val start = Instant.parse("2026-01-01T00:00:00Z")
        val first = tx.execute { tokens.issueFamily(auth.user(), UUID.randomUUID(), start) }!!
        assertEquals(start.plus(RefreshTokenService.FAMILY_TTL), first.row.familyExpiresAt)
        assertEquals(start.plus(RefreshTokenService.TTL), first.row.expiresAt)
        var current = first
        listOf(50L, 100L, 150L).forEach { days ->
            val result = tx.execute { tokens.present(current.token, start.plusSeconds(days * 86400), { true }, {}) }!!
            current = assertIs<RotationResult.Rotated>(result).issued
            assertEquals(first.row.familyExpiresAt, current.row.familyExpiresAt)
        }
        assertEquals(first.row.familyExpiresAt, current.row.expiresAt)
        val familyEnd = first.row.familyExpiresAt
        val revokedBefore = revoked(first.row.familyId)
        listOf(first.token, current.token).forEach { token ->
            assertEquals(RotationResult.Rejected, tx.execute { tokens.present(token, familyEnd, { true }, { error("must not rotate") }) })
        }
        assertEquals(revokedBefore, revoked(first.row.familyId))
        assertNotNull(current.row.id)
    }

    @Test
    fun `HTTP refresh after family end is 401 and leaves the family unchanged`() {
        val first = tx.execute { tokens.issueFamily(auth.user(), UUID.randomUUID(), Instant.now().minusSeconds(181 * 86400L)) }!!
        mvc
            .post("/v1/auth/refresh") {
                contentType = MediaType.APPLICATION_JSON
                content = """{"refreshToken":"${first.token}"}"""
                with { request ->
                    request.remoteAddr = AuthApi.randomIp()
                    request
                }
            }.andExpect {
                status { isUnauthorized() }
                jsonPath("$.code") { value("auth.refresh_invalid") }
            }
        assertEquals(0, revoked(first.row.familyId))
    }

    private fun revoked(familyId: UUID): Int =
        jdbc.queryForObject(
            "SELECT count(*) FROM refresh_tokens WHERE family_id = ? AND revoked_at IS NOT NULL",
            Int::class.java,
            familyId,
        )!!
}
