package app.cetele.server.auth.otp

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
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

/** Login and sensitive account actions use separate one-time codes. */
enum class OtpPurpose {
    LOGIN,
    REAUTH,
}

/** A one-time code. The code itself is never stored, only [codeHmac]. */
@Entity
@Table(name = "otp_codes")
class OtpCode(
    @Column(name = "phone_e164", nullable = false, updatable = false)
    val phoneE164: String,
    @Column(name = "device_id", nullable = false, updatable = false)
    val deviceId: UUID,
    @Enumerated(EnumType.STRING)
    @Column(name = "purpose", nullable = false, updatable = false)
    val purpose: OtpPurpose,
    @Column(name = "code_hmac", nullable = false, updatable = false)
    val codeHmac: ByteArray,
    @Column(name = "expires_at", nullable = false, updatable = false)
    val expiresAt: Instant,
    @Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant,
) {
    @Id
    @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    var id: UUID? = null

    @Column(name = "attempts", nullable = false)
    var attempts: Int = 0

    @Column(name = "consumed_at")
    var consumedAt: Instant? = null
}

interface OtpCodeRepository : Repository<OtpCode, UUID> {
    fun save(code: OtpCode): OtpCode

    /** The newest open code of a phone, locked so concurrent guesses are counted one by one. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    fun findFirstByPhoneE164AndPurposeAndConsumedAtIsNullOrderByCreatedAtDesc(
        phoneE164: String,
        purpose: OtpPurpose,
    ): OtpCode?

    /** Closes every open code of a phone, so only the newest code can ever be used. */
    @Modifying
    @Query("UPDATE OtpCode c SET c.consumedAt = :now WHERE c.phoneE164 = :phone AND c.purpose = :purpose AND c.consumedAt IS NULL")
    fun consumeOpen(
        @Param("phone") phoneE164: String,
        @Param("purpose") purpose: OtpPurpose,
        @Param("now") now: Instant,
    ): Int
}
