package app.cetele.server.auth.otp

import app.cetele.server.auth.sms.SmsGateway
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.security.SecureRandom
import java.time.Duration
import java.time.Instant
import java.util.UUID

/** Outcome of checking a submitted code. */
sealed interface OtpCheck {
    /** The code matched and is now consumed; [issuedAt] is when it was created. */
    data class Accepted(
        val issuedAt: Instant,
    ) : OtpCheck

    /** No open code, expired, wrong code, wrong device or attempts used up: one answer for all. */
    data object Rejected : OtpCheck
}

/**
 * Issues and checks one-time codes: six digits from [SecureRandom], stored as an HMAC, valid for
 * five minutes, single use, five attempts. Issuing a code closes every older open code of the
 * phone. [issue] and [check] run inside the caller's transaction; [deliver] runs after commit.
 */
@Service
class OtpService(
    private val codes: OtpCodeRepository,
    private val hasher: OtpHasher,
    private val sms: SmsGateway,
    private val settings: OtpSettings,
) {
    private val log = LoggerFactory.getLogger(OtpService::class.java)
    private val echo = LoggerFactory.getLogger(LOCAL_ECHO_LOGGER)
    private val random = SecureRandom()

    /** Stores a new code and returns the SMS text carrying it; send it with [deliver] after commit. */
    fun issue(
        phoneE164: String,
        deviceId: UUID,
        now: Instant,
    ): String {
        codes.consumeOpen(phoneE164, OtpPurpose.LOGIN, now)
        val code = newCode()
        codes.save(
            OtpCode(
                phoneE164 = phoneE164,
                deviceId = deviceId,
                purpose = OtpPurpose.LOGIN,
                codeHmac = hasher.hmac(phoneE164, code),
                expiresAt = now.plus(TTL),
                createdAt = now,
            ),
        )
        return message(code)
    }

    fun deliver(
        phoneE164: String,
        text: String,
    ) {
        sms.send(phoneE164, text)
        if (settings.localEcho) echo.info(text)
    }

    /**
     * Checks [code] against the newest open code of the phone. Every failed check counts as an
     * attempt; the [MAX_ATTEMPTS]th failure closes the code. The HMAC is computed even when no
     * code is open, so the answer takes the same work either way.
     */
    fun check(
        phoneE164: String,
        deviceId: UUID,
        code: String,
        now: Instant,
    ): OtpCheck {
        val open = codes.findFirstByPhoneE164AndPurposeAndConsumedAtIsNullOrderByCreatedAtDesc(phoneE164, OtpPurpose.LOGIN)
        val codeMatches = hasher.matches(phoneE164, code, open?.codeHmac ?: EMPTY_HMAC)
        if (open == null) return OtpCheck.Rejected
        if (!now.isBefore(open.expiresAt) || open.attempts >= MAX_ATTEMPTS) {
            open.consumedAt = now
            codes.save(open)
            return OtpCheck.Rejected
        }
        if (!codeMatches || open.deviceId != deviceId) {
            open.attempts += 1
            if (open.attempts >= MAX_ATTEMPTS) open.consumedAt = now
            codes.save(open)
            log.info("OTP check outcome=mismatch attempts={}", open.attempts)
            return OtpCheck.Rejected
        }
        open.consumedAt = now
        codes.save(open)
        return OtpCheck.Accepted(open.createdAt)
    }

    private fun newCode(): String = random.nextInt(CODE_SPACE).toString().padStart(CODE_LENGTH, '0')

    companion object {
        val TTL: Duration = Duration.ofMinutes(5)
        const val MAX_ATTEMPTS = 5
        const val CODE_LENGTH = 6
        private const val CODE_SPACE = 1_000_000
        private val EMPTY_HMAC = ByteArray(32)

        /** Logger of the local-only echo of SMS texts (`CETELE_OTP_LOCAL_ECHO`). */
        const val LOCAL_ECHO_LOGGER = "LOCAL_ECHO"

        fun message(code: String): String = "Çetele giriş kodunuz: $code. Bu kodu kimseyle paylaşmayın."
    }
}
