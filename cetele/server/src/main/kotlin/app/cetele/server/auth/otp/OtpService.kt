package app.cetele.server.auth.otp

import app.cetele.server.account.ReauthAction
import app.cetele.server.auth.AuthLocks
import app.cetele.server.reminders.sms.SmsGateway
import app.cetele.server.reminders.sms.SmsKind
import app.cetele.server.reminders.sms.SmsMessage
import app.cetele.server.reminders.sms.SmsSendResult
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
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
 * phone and purpose. [issue] and [check] run inside the caller's transaction; [deliver] runs after commit.
 */
@Service
class OtpService(
    private val codes: OtpCodeRepository,
    private val locks: AuthLocks,
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
        purpose: OtpPurpose,
        now: Instant,
        scope: String? = null,
    ): String {
        require((purpose == OtpPurpose.LOGIN && scope == null) || (purpose == OtpPurpose.REAUTH && scope != null))
        // Serialised per phone: a concurrent issue must see and close this code, so one code stays open.
        locks.otpPhone(phoneE164)
        val since = now.minus(DAILY_WINDOW)
        if (codes.countByPhoneE164AndPurposeAndCreatedAtAfter(phoneE164, purpose, since) >= settings.dailyLimit) {
            val oldest = checkNotNull(codes.findFirstByPhoneE164AndPurposeAndCreatedAtAfterOrderByCreatedAtAsc(phoneE164, purpose, since))
            val remaining = Duration.between(now, oldest.createdAt.plus(DAILY_WINDOW))
            val retryAfter = (remaining.seconds + if (remaining.nano > 0) 1 else 0).coerceAtLeast(1)
            throw ProblemException(ProblemCode.RATE_LIMITED, headers = mapOf("Retry-After" to retryAfter.toString()))
        }
        codes.consumeOpen(phoneE164, purpose, now)
        val code = newCode()
        codes.save(
            OtpCode(
                phoneE164 = phoneE164,
                deviceId = deviceId,
                purpose = purpose,
                codeHmac = hasher.hmac(phoneE164, code),
                expiresAt = now.plus(TTL),
                createdAt = now,
                scope = scope,
            ),
        )
        return message(code, purpose, scope)
    }

    fun deliver(
        phoneE164: String,
        text: String,
    ) {
        val result = sms.send(SmsMessage(phoneE164, text, SmsKind.OTP))
        if (result !is SmsSendResult.Accepted) log.warn("OTP delivery outcome=send_failed")
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
        purpose: OtpPurpose,
        code: String,
        now: Instant,
        scope: String? = null,
    ): OtpCheck {
        val open = codes.findFirstByPhoneE164AndPurposeAndConsumedAtIsNullOrderByCreatedAtDesc(phoneE164, purpose)
        val codeMatches = hasher.matches(phoneE164, code, open?.codeHmac ?: EMPTY_HMAC)
        if (open == null) return OtpCheck.Rejected
        if (!now.isBefore(open.expiresAt) || open.attempts >= MAX_ATTEMPTS) {
            open.consumedAt = now
            codes.save(open)
            return OtpCheck.Rejected
        }
        if (!codeMatches || open.deviceId != deviceId || open.scope != scope || (purpose == OtpPurpose.REAUTH && scope == null)) {
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
        val DAILY_WINDOW: Duration = Duration.ofHours(24)
        const val MAX_ATTEMPTS = 5
        const val CODE_LENGTH = 6
        private const val CODE_SPACE = 1_000_000
        private val EMPTY_HMAC = ByteArray(32)

        /** Logger of the local-only echo of SMS texts (`CETELE_OTP_LOCAL_ECHO`). */
        const val LOCAL_ECHO_LOGGER = "LOCAL_ECHO"

        fun message(
            code: String,
            purpose: OtpPurpose = OtpPurpose.LOGIN,
            scope: String? = null,
        ): String {
            if (purpose == OtpPurpose.LOGIN) return "Çetele giriş kodunuz: $code. Bu kodu kimseyle paylaşmayın."
            val action = ReauthAction.valueOf(checkNotNull(scope).substringBefore(':'))
            return "Çetele onay kodunuz: $code. Bu kod ${action.smsText} içindir, giriş kodu değildir. " +
                "Kimseyle paylaşmayın; Çetele bu kodu sizden telefonla istemez."
        }
    }
}
