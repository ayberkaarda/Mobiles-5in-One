package app.cetele.server.sync.web

import app.cetele.server.security.CurrentUser
import app.cetele.server.sync.PullResponse
import app.cetele.server.sync.PushRequest
import app.cetele.server.sync.PushResponse
import app.cetele.server.sync.SyncService
import io.swagger.v3.oas.annotations.Parameter
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

@RestController
@RequestMapping("/v1/shops/{shopId}/sync")
class SyncController(
    private val sync: SyncService,
) {
    @PostMapping("/push")
    @PreAuthorize("@perm.can(#shopId, 'SHOP_READ')")
    fun push(
        @PathVariable shopId: UUID,
        @Parameter(hidden = true) @AuthenticationPrincipal caller: CurrentUser,
        @RequestBody body: PushRequest,
    ): PushResponse = sync.push(shopId, caller, body)

    @GetMapping("/pull")
    @PreAuthorize("@perm.can(#shopId, 'CUSTOMER_READ') and @perm.can(#shopId, 'LEDGER_READ')")
    fun pull(
        @PathVariable shopId: UUID,
        @Parameter(hidden = true) @AuthenticationPrincipal caller: CurrentUser,
        @RequestParam(defaultValue = "0") since: Long,
        @RequestParam(defaultValue = "500") limit: Int,
    ): PullResponse = sync.pull(shopId, caller, since, limit)
}
