package app.cetele.server.auth.token

import app.cetele.server.security.TraceIdFilter
import org.springframework.stereotype.Service
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Duration
import java.time.Instant
import java.util.Base64
import java.util.UUID

/** A freshly issued refresh token: [token] goes to the client once and is never stored. */
data class IssuedRefreshToken(
    val token: String,
    val row: RefreshToken,
)

/** Outcome of presenting a refresh token. */
sealed interface RotationResult {
    data class Rotated(
        val issued: IssuedRefreshToken,
    ) : RotationResult

    /** No row has this hash. */
    data object Unknown : RotationResult

    /** Expired, or the user is gone; the family is left as it is. */
    data object Rejected : RotationResult

    /** A revoked or already rotated token came back: the whole family was revoked. */
    data object ReuseDetected : RotationResult
}

/**
 * Opaque refresh tokens: 32 random bytes, base64url, stored as SHA-256, valid 60 days from their
 * issue. Each use rotates the token; presenting a token that is no longer current (rotated,
 * revoked, logged out) is treated as theft and revokes every token of its family.
 * All methods run inside the caller's transaction.
 */
@Service
class RefreshTokenService(
    private val tokens: RefreshTokenRepository,
) {
    private val random = SecureRandom()

    /** Starts a new family for a sign-in. */
    fun issueFamily(
        userId: UUID,
        deviceId: UUID,
        now: Instant,
    ): IssuedRefreshToken = issue(userId, deviceId, TraceIdFilter.uuidV7(), rotatedFrom = null, now = now)

    /** Looks the token up under a row lock; `null` when no row has its hash. */
    fun lookup(token: String): RefreshToken? {
        if (token.isEmpty() || token.length > MAX_TOKEN_LENGTH) return null
        return tokens.findByTokenHash(hash(token))
    }

    /**
     * Rotates [current] (from [lookup]). [userActive] is checked after reuse detection, so a
     * replayed token of a deactivated user still revokes its family.
     */
    fun rotate(
        current: RefreshToken,
        userActive: Boolean,
        now: Instant,
    ): RotationResult {
        if (current.revokedAt != null) {
            tokens.revokeFamily(current.familyId, now)
            return RotationResult.ReuseDetected
        }
        if (!now.isBefore(current.expiresAt) || !userActive) return RotationResult.Rejected
        current.revokedAt = now
        tokens.save(current)
        return RotationResult.Rotated(issue(current.userId, current.deviceId, current.familyId, current.id, now))
    }

    /** Logout: revokes every live token of the caller's device. */
    fun revokeDevice(
        userId: UUID,
        deviceId: UUID,
        now: Instant,
    ): Int = tokens.revokeDevice(userId, deviceId, now)

    private fun issue(
        userId: UUID,
        deviceId: UUID,
        familyId: UUID,
        rotatedFrom: UUID?,
        now: Instant,
    ): IssuedRefreshToken {
        val bytes = ByteArray(TOKEN_BYTES).also { random.nextBytes(it) }
        val token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        val row = tokens.save(RefreshToken(hash(token), userId, deviceId, familyId, now.plus(TTL), rotatedFrom, now))
        return IssuedRefreshToken(token, row)
    }

    companion object {
        val TTL: Duration = Duration.ofDays(60)
        const val TOKEN_BYTES = 32

        /** 32 bytes in unpadded base64url are 43 characters; longer input is never looked up. */
        private const val MAX_TOKEN_LENGTH = 128

        fun hash(token: String): ByteArray = MessageDigest.getInstance("SHA-256").digest(token.toByteArray(Charsets.UTF_8))
    }
}
