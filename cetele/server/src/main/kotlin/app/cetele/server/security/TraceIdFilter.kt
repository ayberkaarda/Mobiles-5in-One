package app.cetele.server.security

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.MDC
import org.springframework.web.filter.OncePerRequestFilter
import java.security.SecureRandom
import java.util.UUID

/**
 * Gives every request a fresh UUIDv7 trace id: request attribute, MDC key and `X-Trace-Id`
 * response header. Incoming trace headers are ignored on purpose, so a client cannot inject
 * values into the logs or correlate requests of other users.
 *
 * Registered as the first servlet filter (before the security chain), so 401/403 bodies and
 * every log line of the request carry the id.
 */
class TraceIdFilter : OncePerRequestFilter() {
    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        val traceId = uuidV7().toString()
        request.setAttribute(ATTRIBUTE, traceId)
        response.setHeader(HEADER, traceId)
        MDC.put(MDC_KEY, traceId)
        try {
            filterChain.doFilter(request, response)
        } finally {
            MDC.remove(MDC_KEY)
        }
    }

    override fun shouldNotFilterErrorDispatch(): Boolean = false

    companion object {
        const val HEADER = "X-Trace-Id"
        const val MDC_KEY = "traceId"
        const val ATTRIBUTE = "app.cetele.traceId"

        private val random = SecureRandom()

        /** Trace id of the current request: request attribute first, then MDC. */
        fun current(request: HttpServletRequest?): String? = request?.getAttribute(ATTRIBUTE) as? String ?: MDC.get(MDC_KEY)

        /** RFC 9562 version 7: 48-bit Unix milliseconds, version and variant bits, 74 random bits. */
        fun uuidV7(nowMillis: Long = System.currentTimeMillis()): UUID {
            val randomBytes = ByteArray(10)
            random.nextBytes(randomBytes)
            val randA = ((randomBytes[0].toLong() and 0xFF) shl 8 or (randomBytes[1].toLong() and 0xFF)) and 0x0FFF
            val msb = (nowMillis and 0xFFFF_FFFF_FFFFL) shl 16 or (0x7L shl 12) or randA
            var lsb = 0L
            for (i in 2 until 10) {
                lsb = (lsb shl 8) or (randomBytes[i].toLong() and 0xFF)
            }
            lsb = (lsb and 0x3FFF_FFFF_FFFF_FFFFL) or Long.MIN_VALUE
            return UUID(msb, lsb)
        }
    }
}
