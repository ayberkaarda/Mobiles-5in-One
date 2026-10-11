package app.cetele.server.admin

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import jakarta.servlet.http.HttpSession
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.security.core.context.SecurityContextHolderStrategy
import org.springframework.web.filter.OncePerRequestFilter
import java.time.Clock
import java.time.Duration
import java.time.Instant

/** Session attribute names and the fixed lifetimes of the console session (ADR-0033). */
object AdminSessionPolicy {
    const val STARTED_AT = "app.cetele.admin.startedAt"
    const val LAST_SEEN_AT = "app.cetele.admin.lastSeenAt"
    const val PENDING = "app.cetele.admin.pending"
    const val COOKIE_NAME = "__Host-CETELE_ADMIN"
    val IDLE: Duration = Duration.ofMinutes(30)
    val ABSOLUTE: Duration = Duration.ofHours(12)

    /** `true` when a session started at [startedAt] and last used at [lastSeenAt] has ended at [now]. */
    fun isExpired(
        startedAt: Instant?,
        lastSeenAt: Instant?,
        now: Instant,
    ): Boolean {
        if (startedAt == null || lastSeenAt == null) return true
        return !now.isBefore(startedAt.plus(ABSOLUTE)) || !now.isBefore(lastSeenAt.plus(IDLE))
    }

    /** Marks a console session as started now (after the password step). */
    fun start(
        session: HttpSession,
        now: Instant,
    ) {
        session.maxInactiveInterval = IDLE.toSeconds().toInt()
        session.setAttribute(STARTED_AT, now)
        session.setAttribute(LAST_SEEN_AT, now)
    }
}

/**
 * Ends console sessions that are idle for 30 minutes or older than 12 hours (the container's
 * `maxInactiveInterval` is the first line; this check uses the application clock), and signed-in
 * sessions whose account was disabled, locked, changed role, changed password or enrolled a new
 * authenticator since the login. An ended session is
 * invalidated before authorization runs, so the request continues as anonymous.
 */
class AdminSessionFilter(
    private val clock: Clock,
    private val isCurrent: (AdminPrincipal) -> Boolean,
) : OncePerRequestFilter() {
    private val strategy: SecurityContextHolderStrategy = SecurityContextHolder.getContextHolderStrategy()

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        val session = request.getSession(false)
        if (session != null) {
            val now = clock.instant()
            val principal = AdminPrincipal.of(strategy.context.authentication)
            val tracked =
                session.getAttribute(AdminSessionPolicy.STARTED_AT) != null || principal != null ||
                    session.getAttribute(AdminSessionPolicy.PENDING) != null
            val expired =
                tracked &&
                    AdminSessionPolicy.isExpired(
                        session.getAttribute(AdminSessionPolicy.STARTED_AT) as? Instant,
                        session.getAttribute(AdminSessionPolicy.LAST_SEEN_AT) as? Instant,
                        now,
                    )
            if (expired || (principal != null && !isCurrent(principal))) {
                session.invalidate()
                strategy.clearContext()
            } else if (tracked) {
                session.setAttribute(AdminSessionPolicy.LAST_SEEN_AT, now)
            }
        }
        filterChain.doFilter(request, response)
    }
}
