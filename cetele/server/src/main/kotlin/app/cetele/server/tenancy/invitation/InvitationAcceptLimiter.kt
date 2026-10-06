package app.cetele.server.tenancy.invitation

import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import com.github.benmanes.caffeine.cache.Cache
import com.github.benmanes.caffeine.cache.Caffeine
import io.github.bucket4j.Bandwidth
import io.github.bucket4j.Bucket
import org.springframework.stereotype.Component
import java.time.Duration
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Invitation accept attempts: 10 per 10 minutes per user, counted for every attempt (valid or
 * not), so the 40-bit code space cannot be probed from one account. Buckets live in memory
 * (Caffeine), keyed `invite.accept:<userId>`.
 */
@Component
class InvitationAcceptLimiter {
    private val buckets: Cache<String, Bucket> =
        Caffeine
            .newBuilder()
            .expireAfterAccess(WINDOW)
            .maximumSize(MAX_TRACKED_USERS)
            .build()

    fun consume(userId: UUID) {
        val bucket = buckets.get("invite.accept:$userId") { newBucket() }
        val probe = bucket.tryConsumeAndReturnRemaining(1)
        if (!probe.isConsumed) {
            val retryAfter = maxOf(1L, TimeUnit.NANOSECONDS.toSeconds(probe.nanosToWaitForRefill) + 1)
            throw ProblemException(
                ProblemCode.RATE_LIMITED,
                "invitation accept limit reached",
                headers = mapOf("Retry-After" to retryAfter.toString()),
            )
        }
    }

    private fun newBucket(): Bucket =
        Bucket
            .builder()
            .addLimit(
                Bandwidth
                    .builder()
                    .capacity(CAPACITY)
                    .refillIntervally(CAPACITY, WINDOW)
                    .build(),
            ).build()

    companion object {
        const val CAPACITY = 10L
        val WINDOW: Duration = Duration.ofMinutes(10)
        private const val MAX_TRACKED_USERS = 100_000L
    }
}
