package app.cetele.server.reminders.web

import app.cetele.server.auth.ratelimit.RateLimit
import app.cetele.server.auth.ratelimit.RateLimiter
import app.cetele.server.reminders.ReminderRequest
import app.cetele.server.reminders.ReminderService
import app.cetele.server.security.CurrentUser
import org.springframework.http.HttpStatus
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

@RestController
@RequestMapping("/v1/shops/{shopId}/reminders")
class ReminderController(
    private val service: ReminderService,
    private val limiter: RateLimiter,
) {
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("@perm.can(#shopId, 'REMINDER_SEND')")
    fun send(
        @PathVariable shopId: UUID,
        @AuthenticationPrincipal user: CurrentUser,
        @RequestBody request: ReminderRequest,
    ) = run {
        limiter.consume(RateLimit.REMINDER_USER, user.userId.toString())
        service.send(shopId, user.userId, request)
    }
}
