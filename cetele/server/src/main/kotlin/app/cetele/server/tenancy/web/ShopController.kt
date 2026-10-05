package app.cetele.server.tenancy.web

import app.cetele.server.security.CurrentUser
import app.cetele.server.tenancy.shop.NewShop
import app.cetele.server.tenancy.shop.ShopChanges
import app.cetele.server.tenancy.shop.ShopService
import app.cetele.server.tenancy.shop.ShopView
import io.swagger.v3.oas.annotations.Parameter
import jakarta.validation.Valid
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.net.URI
import java.util.UUID

/**
 * Shops. Every handler states its permission; the shop id always comes from the path and is
 * checked against the caller's membership, never taken from a request body.
 */
@RestController
@RequestMapping("/v1/shops")
class ShopController(
    private val shops: ShopService,
) {
    /** Any authenticated user may open a shop; the caller becomes its `OWNER`. */
    @PreAuthorize("isAuthenticated()")
    @PostMapping
    fun create(
        @Parameter(hidden = true) @AuthenticationPrincipal caller: CurrentUser,
        @Valid @RequestBody body: CreateShopRequest,
    ): ResponseEntity<ShopView> {
        val shop = shops.create(caller, NewShop(name = body.name, type = body.type, il = body.il, ilce = body.ilce))
        return ResponseEntity.created(URI.create("/v1/shops/${shop.id}")).body(shop)
    }

    @PreAuthorize("@perm.can(#shopId, 'SHOP_READ')")
    @GetMapping("/{shopId}")
    fun get(
        @PathVariable shopId: UUID,
        @Parameter(hidden = true) @AuthenticationPrincipal caller: CurrentUser,
    ): ShopView = shops.get(shopId, caller)

    @PreAuthorize("@perm.can(#shopId, 'SHOP_MANAGE')")
    @PatchMapping("/{shopId}")
    fun update(
        @PathVariable shopId: UUID,
        @Parameter(hidden = true) @AuthenticationPrincipal caller: CurrentUser,
        @Valid @RequestBody body: UpdateShopRequest,
    ): ShopView = shops.update(shopId, caller, ShopChanges(name = body.name, type = body.type, il = body.il, ilce = body.ilce))
}
