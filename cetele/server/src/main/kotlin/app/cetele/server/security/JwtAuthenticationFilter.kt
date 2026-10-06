package app.cetele.server.security

import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import app.cetele.server.web.problem.ProblemWriter
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.LoggerFactory
import org.springframework.http.HttpHeaders
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.web.filter.OncePerRequestFilter
import java.util.UUID

/**
 * Reads `Authorization: Bearer <jwt>`, verifies it with [JwtCodec] and sets a [CurrentUser]
 * principal. A present but invalid token, or a token of an unknown or deactivated user
 * (`users.deactivated_at`), ends the request with 401 `auth.unauthenticated`.
 *
 * Requests without the header pass through anonymously; the authorization rules of the
 * security chain decide whether that is allowed. The OTP and refresh endpoints ignore the
 * header entirely, so a client holding an expired access token can still refresh.
 */
class JwtAuthenticationFilter(
    private val codec: JwtCodec,
    private val isActiveUser: (UUID) -> Boolean,
    private val problems: ProblemWriter,
) : OncePerRequestFilter() {
    private val log = LoggerFactory.getLogger(JwtAuthenticationFilter::class.java)

    override fun shouldNotFilter(request: HttpServletRequest): Boolean =
        request.requestURI.removePrefix(request.contextPath) in TOKEN_FREE_PATHS

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        val header = request.getHeader(HttpHeaders.AUTHORIZATION)
        if (header == null) {
            filterChain.doFilter(request, response)
            return
        }
        val user =
            try {
                authenticate(header)
            } catch (ex: ProblemException) {
                log.debug("Bearer authentication failed: {}", ex.detail)
                SecurityContextHolder.clearContext()
                problems.write(request, response, ProblemCode.AUTH_UNAUTHENTICATED)
                return
            }
        val context = SecurityContextHolder.createEmptyContext()
        context.authentication = UsernamePasswordAuthenticationToken.authenticated(user, null, emptyList())
        SecurityContextHolder.setContext(context)
        try {
            filterChain.doFilter(request, response)
        } finally {
            SecurityContextHolder.clearContext()
        }
    }

    private fun authenticate(header: String): CurrentUser {
        if (!header.regionMatches(0, BEARER_PREFIX, 0, BEARER_PREFIX.length, ignoreCase = true)) {
            throw ProblemException(ProblemCode.AUTH_UNAUTHENTICATED, "not a bearer token")
        }
        val user = codec.verify(header.substring(BEARER_PREFIX.length).trim())
        if (!isActiveUser(user.userId)) throw ProblemException(ProblemCode.AUTH_UNAUTHENTICATED, "unknown or deactivated user")
        return user
    }

    companion object {
        private const val BEARER_PREFIX = "Bearer "

        /** Public auth endpoints that never look at the Authorization header. */
        val TOKEN_FREE_PATHS = setOf("/v1/auth/otp/request", "/v1/auth/otp/verify", "/v1/auth/refresh")
    }
}
