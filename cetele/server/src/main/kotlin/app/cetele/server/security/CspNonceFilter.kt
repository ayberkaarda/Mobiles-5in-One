package app.cetele.server.security

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.web.filter.OncePerRequestFilter
import java.security.SecureRandom
import java.util.Base64

/**
 * Creates a 128-bit nonce per request, exposes it to templates as the request attribute
 * `cspNonce` (`th:attr="nonce=${cspNonce}"`) and sends the matching Content-Security-Policy.
 */
class CspNonceFilter : OncePerRequestFilter() {
    private val random = SecureRandom()

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        val bytes = ByteArray(NONCE_BYTES)
        random.nextBytes(bytes)
        val nonce = Base64.getEncoder().encodeToString(bytes)
        request.setAttribute(ATTRIBUTE, nonce)
        response.setHeader(HEADER, policy(nonce))
        filterChain.doFilter(request, response)
    }

    companion object {
        const val ATTRIBUTE = "cspNonce"
        const val HEADER = "Content-Security-Policy"
        private const val NONCE_BYTES = 16

        fun policy(nonce: String): String =
            "default-src 'none'; script-src 'self' 'nonce-$nonce'; style-src 'self' 'nonce-$nonce'; img-src 'self' data:; " +
                "font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    }
}
