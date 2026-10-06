package app.cetele.server.statements.web

import app.cetele.server.auth.ratelimit.RateLimit
import app.cetele.server.auth.ratelimit.RateLimiter
import app.cetele.server.config.ClientIp
import app.cetele.server.statements.StatementAssembler
import app.cetele.server.statements.link.StatementLinkService
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.LoggerFactory
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.stereotype.Controller
import org.springframework.ui.Model
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import java.time.Clock

@Controller
class StatementPageController(
    private val links: StatementLinkService,
    private val assembler: StatementAssembler,
    private val limits: RateLimiter,
    private val clock: Clock,
) {
    private val log = LoggerFactory.getLogger(StatementPageController::class.java)

    @GetMapping("/s/{token}", produces = ["text/html; charset=utf-8"])
    @PreAuthorize("permitAll()")
    fun page(
        @PathVariable token: String,
        request: HttpServletRequest,
        response: HttpServletResponse,
        model: Model,
    ): String {
        limits.consume(RateLimit.STATEMENT_PAGE_IP, ClientIp.of(request))
        response.contentType = "text/html; charset=utf-8"
        response.setHeader("Cache-Control", "no-store")
        response.setHeader("Pragma", "no-cache")
        response.setHeader("X-Robots-Tag", "noindex, nofollow")
        model.addAttribute("cspNonce", request.getAttribute("cspNonce"))
        val link = links.resolve(token, clock.instant())
        val data = link?.let { assembler.assemble(it.shopId, it.customerId) }
        if (data == null) {
            response.status = 404
            log.info("Statement route=/s/{token} outcome=not_found")
            return "statement-not-found"
        }
        val resolved = checkNotNull(link)
        links.markOpened(resolved.id, clock.instant())
        model.addAttribute("statement", data)
        log.info("Statement route=/s/{token} outcome=opened shop={} link={}", resolved.shopId, resolved.id)
        return "statement"
    }
}
