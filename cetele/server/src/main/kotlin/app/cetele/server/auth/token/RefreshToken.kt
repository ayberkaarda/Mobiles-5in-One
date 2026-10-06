package app.cetele.server.auth.token

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.LockModeType
import jakarta.persistence.Table
import org.hibernate.annotations.UuidGenerator
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.Repository
import org.springframework.data.repository.query.Param
import java.time.Instant
import java.util.UUID

/**
 * One refresh token of a family. Only the SHA-256 of the token is stored. A rotation revokes the
 * presented row and inserts its successor with [rotatedFrom]; every row of a sign-in shares
 * [familyId].
 */
@Entity
@Table(name = "refresh_tokens")
class RefreshToken(
    @Column(name = "token_hash", nullable = false, updatable = false)
    val tokenHash: ByteArray,
    @Column(name = "user_id", nullable = false, updatable = false)
    val userId: UUID,
    @Column(name = "device_id", nullable = false, updatable = false)
    val deviceId: UUID,
    @Column(name = "family_id", nullable = false, updatable = false)
    val familyId: UUID,
    @Column(name = "expires_at", nullable = false, updatable = false)
    val expiresAt: Instant,
    @Column(name = "rotated_from", updatable = false)
    val rotatedFrom: UUID?,
    @Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant,
    @Column(name = "family_expires_at", nullable = false, updatable = false)
    val familyExpiresAt: Instant,
) {
    @Id
    @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    var id: UUID? = null

    @Column(name = "revoked_at")
    var revokedAt: Instant? = null
}

interface RefreshTokenRepository : Repository<RefreshToken, UUID> {
    fun save(token: RefreshToken): RefreshToken

    /** Resolves the family of a token without loading (and caching) the row itself. */
    @Query("SELECT t.familyId FROM RefreshToken t WHERE t.tokenHash = :hash")
    fun findFamilyIdByTokenHash(
        @Param("hash") tokenHash: ByteArray,
    ): UUID?

    /** Read after the family lock is held; the row lock is a second line of defence. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    fun findByTokenHash(tokenHash: ByteArray): RefreshToken?

    /** Families that still have a live token on this device (the ones logout must lock). */
    @Query("SELECT DISTINCT t.familyId FROM RefreshToken t WHERE t.userId = :user AND t.deviceId = :device AND t.revokedAt IS NULL")
    fun findLiveFamilyIds(
        @Param("user") userId: UUID,
        @Param("device") deviceId: UUID,
    ): List<UUID>

    @Modifying
    @Query("UPDATE RefreshToken t SET t.revokedAt = :now WHERE t.familyId = :family AND t.revokedAt IS NULL")
    fun revokeFamily(
        @Param("family") familyId: UUID,
        @Param("now") now: Instant,
    ): Int

    @Modifying
    @Query("UPDATE RefreshToken t SET t.revokedAt = :now WHERE t.userId = :user AND t.deviceId = :device AND t.revokedAt IS NULL")
    fun revokeDevice(
        @Param("user") userId: UUID,
        @Param("device") deviceId: UUID,
        @Param("now") now: Instant,
    ): Int
}
