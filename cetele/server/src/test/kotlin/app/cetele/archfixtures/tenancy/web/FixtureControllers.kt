package app.cetele.archfixtures.tenancy.web

import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

@RestController
class GuardedController {
    @PreAuthorize("@perm.can(#shopId, 'SHOP_READ')")
    @GetMapping("/v1/shops/{shopId}")
    fun shop(
        @PathVariable shopId: UUID,
    ): String = shopId.toString()

    fun helper(): String = "not a handler"
}

@RestController
class UnguardedController {
    @GetMapping("/v1/shops/{shopId}/members")
    fun members(
        @PathVariable shopId: UUID,
    ): String = shopId.toString()
}
