package app.cetele.server.statements

import app.cetele.server.auth.ratelimit.RateLimit
import app.cetele.server.auth.ratelimit.RateLimiter
import app.cetele.server.ledger.customer.CustomerRepository
import app.cetele.server.security.CurrentUser
import app.cetele.server.statements.link.StatementLinkService
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Instant
import java.util.UUID

data class StatementLinkRequest(
    val customerId: UUID,
)

data class StatementLinkResponse(
    val linkId: UUID,
    val url: String,
    val token: String,
    val expiresAt: Instant,
)

@Service
class StatementService(
    private val customers: CustomerRepository,
    private val links: StatementLinkService,
    private val limits: RateLimiter,
    private val clock: Clock,
) {
    @Transactional
    fun issue(
        shopId: UUID,
        caller: CurrentUser,
        body: StatementLinkRequest,
    ): StatementLinkResponse {
        limits.consume(RateLimit.STATEMENT_LINK_USER, caller.userId.toString())
        customers.findActive(shopId, body.customerId) ?: throw ProblemException(ProblemCode.NOT_FOUND)
        val issued = links.issue(shopId, body.customerId, caller.userId, now = clock.instant())
        return StatementLinkResponse(issued.id, issued.url, issued.token, issued.expiresAt)
    }
}
