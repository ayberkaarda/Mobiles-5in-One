package app.cetele.server.support

import app.cetele.server.security.JwtCodec
import app.cetele.server.security.TraceIdFilter
import org.springframework.boot.test.context.TestComponent
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Clock
import java.time.Instant
import java.util.UUID

/**
 * Users and real ES256 access tokens for integration tests. Tokens are minted by the
 * application's own [JwtCodec] (ephemeral key pair in profile `test`), so they pass the same
 * verification as tokens from `POST /v1/auth/otp/verify`.
 *
 * ```
 * val user = auth.user()
 * mvc.get("/v1/me") { header(AUTHORIZATION, auth.bearer(user)) }
 * ```
 */
@TestComponent
class TestAuth(
    private val jdbc: JdbcTemplate,
    private val codec: JwtCodec,
    private val clock: Clock,
) {
    /** Inserts a `users` row and returns its id (UUIDv7, like the application). */
    fun user(
        phone: String = TestUsers.phone(),
        displayName: String? = null,
    ): UUID {
        val id = TraceIdFilter.uuidV7()
        jdbc.update("INSERT INTO users (id, phone_e164, display_name) VALUES (?, ?, ?)", id, phone, displayName)
        return id
    }

    fun deactivate(user: UUID) {
        jdbc.update("UPDATE users SET deactivated_at = now() WHERE id = ?", user)
    }

    fun token(
        user: UUID,
        device: UUID = UUID.randomUUID(),
        now: Instant = clock.instant(),
    ): String = codec.issue(user, device, now)

    /** `Authorization` header value for [user]. */
    fun bearer(
        user: UUID,
        device: UUID = UUID.randomUUID(),
    ): String = bearer(token(user, device))

    companion object {
        fun bearer(token: String): String = "Bearer $token"
    }
}
