package app.cetele.server.billing.web

import app.cetele.server.auth.ratelimit.RateLimit
import app.cetele.server.auth.ratelimit.RateLimiter
import app.cetele.server.billing.BillingService
import app.cetele.server.billing.BillingState
import app.cetele.server.billing.PurchaseTokens
import app.cetele.server.security.CurrentUser
import io.swagger.v3.oas.annotations.Parameter
import jakarta.validation.Valid
import jakarta.validation.constraints.Pattern
import jakarta.validation.constraints.Size
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.time.Clock
import java.util.UUID

/** `POST /v1/shops/{shopId}/billing/link`. Unknown properties are refused with 422 `unknown_property`. */
data class LinkPurchaseRequest(
    @field:Size(min = 1, max = 100)
    @field:Pattern(regexp = "^[a-z0-9][a-z0-9._]*$")
    val productId: String,
    @field:Size(min = 1, max = PurchaseTokens.TOKEN_MAX)
    @field:Pattern(regexp = PurchaseTokens.TOKEN_PATTERN)
    val purchaseToken: String,
) {
    override fun toString(): String = "LinkPurchaseRequest(productId=$productId)"
}

/** Billing of one shop (ADR-0031). The shop always comes from the path and the caller's membership. */
@RestController
@RequestMapping("/v1/shops/{shopId}/billing")
class BillingController(
    private val billing: BillingService,
    private val limiter: RateLimiter,
    private val clock: Clock,
) {
    /** Plan, limits, this month's usage and the current subscription; OWNER and STAFF. */
    @PreAuthorize("@perm.can(#shopId, 'SHOP_READ')")
    @GetMapping
    fun billingState(
        @PathVariable shopId: UUID,
    ): BillingState = billing.state(shopId, clock.instant())

    /** Binds a Play purchase to the shop after Play confirms it; OWNER only. */
    @PreAuthorize("@perm.can(#shopId, 'BILLING_MANAGE')")
    @PostMapping("/link")
    fun linkPurchase(
        @PathVariable shopId: UUID,
        @Parameter(hidden = true) @AuthenticationPrincipal caller: CurrentUser,
        @Valid @RequestBody body: LinkPurchaseRequest,
    ): BillingState {
        limiter.consume(RateLimit.BILLING_LINK_USER, caller.userId.toString())
        return billing.link(shopId, caller.userId, body.productId, body.purchaseToken, clock.instant())
    }
}
