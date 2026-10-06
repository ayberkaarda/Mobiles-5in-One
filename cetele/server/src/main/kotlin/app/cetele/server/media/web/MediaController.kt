package app.cetele.server.media.web

import app.cetele.server.auth.ratelimit.RateLimit
import app.cetele.server.auth.ratelimit.RateLimiter
import app.cetele.server.media.MediaPresignRequest
import app.cetele.server.media.MediaService
import app.cetele.server.security.CurrentUser
import org.springframework.http.HttpStatus
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

@RestController
@RequestMapping("/v1/shops/{shopId}/media")
class MediaController(
    private val service: MediaService,
    private val limiter: RateLimiter,
) {
    @PostMapping("/presign")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("@perm.can(#shopId, 'MEDIA_PRESIGN')")
    fun presign(
        @PathVariable shopId: UUID,
        @AuthenticationPrincipal user: CurrentUser,
        @RequestBody request: MediaPresignRequest,
    ) = run {
        limiter.consume(RateLimit.MEDIA_PRESIGN_USER, user.userId.toString())
        service.presign(shopId, user.userId, request)
    }

    @PostMapping("/{mediaId}/complete")
    @PreAuthorize("@perm.can(#shopId, 'MEDIA_PRESIGN')")
    fun complete(
        @PathVariable shopId: UUID,
        @PathVariable mediaId: UUID,
        @AuthenticationPrincipal user: CurrentUser,
    ) = run {
        limiter.consume(RateLimit.MEDIA_COMPLETE_USER, user.userId.toString())
        service.complete(shopId, mediaId)
    }

    @GetMapping("/{mediaId}")
    @PreAuthorize("@perm.can(#shopId, 'LEDGER_READ')")
    fun download(
        @PathVariable shopId: UUID,
        @PathVariable mediaId: UUID,
        @AuthenticationPrincipal user: CurrentUser,
    ) = run {
        limiter.consume(RateLimit.MEDIA_DOWNLOAD_USER, user.userId.toString())
        service.download(shopId, mediaId)
    }
}
