package app.cetele.server.auth.token

import app.cetele.server.auth.AuthLocks
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
 * issue, capped by a fixed 180-day family lifetime. Inside that lifetime, presenting a token
 * that is no longer current (rotated, revoked, logged out) revokes every token of its family.
 * All methods run inside the caller's transaction.
 */
@Service
class RefreshTokenService(
    private val tokens: RefreshTokenRepository,
    private val locks: AuthLocks,
) {
    private val random = SecureRandom()

    /** Starts a new family for a sign-in. */
    fun issueFamily(
        userId: UUID,
        deviceId: UUID,
        now: Instant,
    ): IssuedRefreshToken =
        issue(userId, deviceId, TraceIdFilter.uuidV7(), rotatedFrom = null, now = now, familyExpiresAt = now.plus(FAMILY_TTL))

    /**
     * Handles a presented refresh token. The family is resolved by hash without loading the row,
     * then locked ([AuthLocks.family]) before the row is read again under a row lock, so rotation,
     * reuse revocation and logout of one family never interleave.
     *
     * Order: absolute family expiry (reject without revocation), then reuse detection, then
     * expiry and [isActive], then [beforeRotation] (the device throttle; throwing there rolls the
     * transaction back with nothing changed), then the rotation itself.
     */
    fun present(
        token: String,
        now: Instant,
        isActive: (UUID) -> Boolean,
        beforeRotation: (RefreshToken) -> Unit,
    ): RotationResult {
        if (token.isEmpty() || token.length > MAX_TOKEN_LENGTH) return RotationResult.Unknown
        val hash = hash(token)
        val familyId = tokens.findFamilyIdByTokenHash(hash) ?: return RotationResult.Unknown
        locks.family(familyId)
        val current = tokens.findByTokenHash(hash) ?: return RotationResult.Unknown
        if (!now.isBefore(current.familyExpiresAt)) return RotationResult.Rejected
        if (current.revokedAt != null) {
            tokens.revokeFamily(current.familyId, now)
            return RotationResult.ReuseDetected
        }
        if (!now.isBefore(current.expiresAt) || !isActive(current.userId)) return RotationResult.Rejected
        beforeRotation(current)
        current.revokedAt = now
        tokens.save(current)
        return RotationResult.Rotated(issue(current.userId, current.deviceId, current.familyId, current.id, now, current.familyExpiresAt))
    }

    /** Logout: revokes every live token of the caller's device, holding the locks of its families. */
    fun revokeDevice(
        userId: UUID,
        deviceId: UUID,
        now: Instant,
    ): Int {
        locks.families(tokens.findLiveFamilyIds(userId, deviceId))
        return tokens.revokeDevice(userId, deviceId, now)
    }

    private fun issue(
        userId: UUID,
        deviceId: UUID,
        familyId: UUID,
        rotatedFrom: UUID?,
        now: Instant,
        familyExpiresAt: Instant,
    ): IssuedRefreshToken {
        val bytes = ByteArray(TOKEN_BYTES).also { random.nextBytes(it) }
        val token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        val row =
            tokens.save(
                RefreshToken(
                    hash(token),
                    userId,
                    deviceId,
                    familyId,
                    minOf(now.plus(TTL), familyExpiresAt),
                    rotatedFrom,
                    now,
                    familyExpiresAt,
                ),
            )
        return IssuedRefreshToken(token, row)
    }

    companion object {
        val TTL: Duration = Duration.ofDays(60)
        val FAMILY_TTL: Duration = Duration.ofDays(180)
        const val TOKEN_BYTES = 32

        /** 32 bytes in unpadded base64url are 43 characters; longer input is never looked up. */
        private const val MAX_TOKEN_LENGTH = 128

        fun hash(token: String): ByteArray = MessageDigest.getInstance("SHA-256").digest(token.toByteArray(Charsets.UTF_8))
    }
}
