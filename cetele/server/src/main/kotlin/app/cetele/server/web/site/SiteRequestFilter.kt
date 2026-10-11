package app.cetele.server.web.site

import app.cetele.server.config.ClientIp
import com.github.benmanes.caffeine.cache.Caffeine
import io.github.bucket4j.BucketConfiguration
import io.github.bucket4j.caffeine.Bucket4jCaffeine
import io.github.bucket4j.distributed.ExpirationAfterWriteStrategy
import io.github.bucket4j.distributed.proxy.ProxyManager
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.LoggerFactory
import org.springframework.http.HttpHeaders
import org.springframework.web.filter.OncePerRequestFilter
import java.time.Duration

/**
 * First filter of the site chain after the headers: only GET and HEAD pass (405 with `Allow`
 * otherwise), then a per-address token bucket in the style of the API's `RateLimiter` (ADR-0009:
 * Bucket4j on Caffeine, whole capacity refilled once per window, key from the trusted client
 * address) answers 429 with `Retry-After` when it is empty.
 */
class SiteRequestFilter(
    requestsPerMinute: Long,
) : OncePerRequestFilter() {
    private val log = LoggerFactory.getLogger(SiteRequestFilter::class.java)

    private val configuration: BucketConfiguration =
        BucketConfiguration
            .builder()
            .addLimit { it.capacity(requestsPerMinute).refillIntervally(requestsPerMinute, WINDOW) }
            .build()

    private val buckets: ProxyManager<String> =
        Bucket4jCaffeine
            .builderFor<String>(Caffeine.newBuilder().maximumSize(MAX_BUCKETS))
            .expirationAfterWrite(ExpirationAfterWriteStrategy.basedOnTimeForRefillingBucketUpToMax(Duration.ofSeconds(1)))
            .build()

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        if (request.method !in ALLOWED_METHODS) {
            response.setHeader(HttpHeaders.ALLOW, ALLOWED_METHODS.joinToString(", "))
            reject(response, HttpServletResponse.SC_METHOD_NOT_ALLOWED, "Bu adres yalnızca okunabilir.")
            return
        }
        val probe = buckets.builder().build(PREFIX + ClientIp.of(request)) { configuration }.tryConsumeAndReturnRemaining(1)
        if (!probe.isConsumed) {
            val seconds = maxOf(1L, Duration.ofNanos(probe.nanosToWaitForRefill).toSeconds() + 1)
            response.setHeader(HttpHeaders.RETRY_AFTER, seconds.toString())
            log.info("Rate limit outcome=rejected limit={}", PREFIX.removeSuffix(":"))
            reject(response, TOO_MANY_REQUESTS, "Çok fazla istek gönderildi. Lütfen biraz sonra yeniden deneyin.")
            return
        }
        filterChain.doFilter(request, response)
    }

    private fun reject(
        response: HttpServletResponse,
        status: Int,
        message: String,
    ) {
        response.status = status
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store")
        response.contentType = "text/plain; charset=utf-8"
        response.writer.write(message + "\n")
        response.flushBuffer()
    }

    companion object {
        val ALLOWED_METHODS = listOf("GET", "HEAD")
        const val PREFIX = "site.page.ip:"
        private const val TOO_MANY_REQUESTS = 429
        private const val MAX_BUCKETS = 200_000L
        private val WINDOW: Duration = Duration.ofMinutes(1)
    }
}
