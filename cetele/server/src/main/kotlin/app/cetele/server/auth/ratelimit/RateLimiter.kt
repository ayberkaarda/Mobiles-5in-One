package app.cetele.server.auth.ratelimit

import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import com.github.benmanes.caffeine.cache.Caffeine
import io.github.bucket4j.BucketConfiguration
import io.github.bucket4j.caffeine.Bucket4jCaffeine
import io.github.bucket4j.distributed.ExpirationAfterWriteStrategy
import io.github.bucket4j.distributed.proxy.ProxyManager
import org.slf4j.LoggerFactory
import org.springframework.http.HttpHeaders
import org.springframework.stereotype.Component
import java.security.MessageDigest
import java.time.Duration
import java.util.HexFormat

/**
 * The sign-in rate limits (spec section 6 item 5). Each limit refills its whole capacity once
 * per window (interval refill), so "3 per 10 minutes" never allows a fourth call inside the
 * window.
 */
enum class RateLimit(
    val prefix: String,
    val capacity: Long,
    val window: Duration,
) {
    OTP_REQUEST_PHONE("otp.phone", 3, Duration.ofMinutes(10)),
    OTP_REQUEST_IP("otp.ip", 10, Duration.ofMinutes(10)),
    OTP_VERIFY_IP("otp.verify.ip", 20, Duration.ofMinutes(10)),
    REFRESH_DEVICE("refresh.device", 30, Duration.ofMinutes(1)),
    REFRESH_IP("refresh.ip", 30, Duration.ofMinutes(1)),
    SYNC_PUSH_USER("sync.push.user", 60, Duration.ofMinutes(1)),
    SYNC_PULL_USER("sync.pull.user", 120, Duration.ofMinutes(1)),
    STATEMENT_LINK_USER("statement.link.user", 30, Duration.ofMinutes(10)),
    STATEMENT_PAGE_IP("statement.page.ip", 60, Duration.ofMinutes(1)),
    STATEMENT_PDF_USER("statement.pdf.user", 20, Duration.ofMinutes(10)),
    REMINDER_USER("reminder.user", 30, Duration.ofMinutes(10)),
    MEDIA_PRESIGN_USER("media.presign.user", 60, Duration.ofMinutes(10)),
    MEDIA_COMPLETE_USER("media.complete.user", 60, Duration.ofMinutes(10)),
    MEDIA_DOWNLOAD_USER("media.download.user", 300, Duration.ofMinutes(10)),
    REAUTH_REQUEST_USER("reauth.request.user", 3, Duration.ofMinutes(10)),
    REAUTH_VERIFY_USER("reauth.verify.user", 10, Duration.ofMinutes(10)),
    ;

    val configuration: BucketConfiguration =
        BucketConfiguration
            .builder()
            .addLimit { it.capacity(capacity).refillIntervally(capacity, window) }
            .build()
}

/**
 * In-memory token buckets (Bucket4j on a Caffeine cache) for one server instance. Bucket keys
 * are `<prefix>:<subject>`; phone numbers are keyed by their SHA-256, never in clear text.
 * A rejected call ends with 429 `rate_limited` and `Retry-After` in whole seconds.
 */
@Component
class RateLimiter {
    private val log = LoggerFactory.getLogger(RateLimiter::class.java)

    private val buckets: ProxyManager<String> =
        Bucket4jCaffeine
            .builderFor<String>(Caffeine.newBuilder().maximumSize(MAX_BUCKETS))
            .expirationAfterWrite(ExpirationAfterWriteStrategy.basedOnTimeForRefillingBucketUpToMax(Duration.ofSeconds(1)))
            .build()

    /** Takes one token from the bucket of [subject] under [limit], or throws 429. */
    fun consume(
        limit: RateLimit,
        subject: String,
    ) {
        val probe = bucket(limit, subject).tryConsumeAndReturnRemaining(1)
        if (!probe.isConsumed) reject(limit, probe.nanosToWaitForRefill)
    }

    /**
     * Throws 429 when the bucket is already empty, without taking a token. Used to refuse a call
     * before any database work when only some outcomes of that work are charged.
     */
    fun requireAvailable(
        limit: RateLimit,
        subject: String,
    ) {
        val estimate = bucket(limit, subject).estimateAbilityToConsume(1)
        if (!estimate.canBeConsumed()) reject(limit, estimate.nanosToWaitForRefill)
    }

    private fun bucket(
        limit: RateLimit,
        subject: String,
    ) = buckets.builder().build(key(limit, subject)) { limit.configuration }

    private fun reject(
        limit: RateLimit,
        nanosToWait: Long,
    ): Nothing {
        val seconds = maxOf(1L, Duration.ofNanos(nanosToWait).toSeconds() + 1)
        log.info("Rate limit outcome=rejected limit={}", limit.prefix)
        throw ProblemException(
            ProblemCode.RATE_LIMITED,
            "rate limit ${limit.prefix}",
            headers = mapOf(HttpHeaders.RETRY_AFTER to seconds.toString()),
        )
    }

    companion object {
        private const val MAX_BUCKETS = 200_000L

        fun key(
            limit: RateLimit,
            subject: String,
        ): String = limit.prefix + ":" + subject

        /** Subject for phone keyed limits: the hex SHA-256 of the E.164 number. */
        fun phoneSubject(phoneE164: String): String =
            HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(phoneE164.toByteArray(Charsets.UTF_8)))
    }
}
