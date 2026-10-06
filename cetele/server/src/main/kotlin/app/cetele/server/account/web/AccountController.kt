package app.cetele.server.account.web

import app.cetele.server.account.AccountDeletionReceipt
import app.cetele.server.account.AccountService
import app.cetele.server.account.DeletionReceipt
import app.cetele.server.account.OwnershipReceipt
import app.cetele.server.security.CurrentUser
import jakarta.validation.Valid
import jakarta.validation.constraints.Pattern
import org.springframework.http.HttpStatus
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

data class ReauthCode(
    @field:Pattern(regexp = "[0-9]{6}", message = "invalid_format") val code: String,
)

data class AccountDeletionBody(
    @field:Pattern(regexp = "[0-9]{6}", message = "invalid_format") val code: String,
    val deleteOwnedShops: Boolean = false,
)

data class OwnershipBody(
    val userId: UUID,
    @field:Pattern(regexp = "[0-9]{6}", message = "invalid_format") val code: String,
)

@RestController
class AccountController(
    private val service: AccountService,
) {
    @DeleteMapping("/v1/me")
    @PreAuthorize("isAuthenticated()")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun deleteAccount(
        @AuthenticationPrincipal caller: CurrentUser,
        @Valid @RequestBody body: AccountDeletionBody,
    ): AccountDeletionReceipt = service.requestAccount(caller, body.code, body.deleteOwnedShops)

    @DeleteMapping("/v1/me/deletion")
    @PreAuthorize("isAuthenticated()")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun cancelAccount(
        @AuthenticationPrincipal caller: CurrentUser,
    ) = service.cancelAccount(caller)

    @DeleteMapping("/v1/shops/{shopId}")
    @PreAuthorize("@perm.can(#shopId, 'MEMBERS_MANAGE')")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun deleteShop(
        @PathVariable shopId: UUID,
        @AuthenticationPrincipal caller: CurrentUser,
        @Valid @RequestBody body: ReauthCode,
    ): DeletionReceipt = service.requestShop(shopId, caller, body.code)

    @DeleteMapping("/v1/shops/{shopId}/deletion")
    @PreAuthorize("@perm.can(#shopId, 'MEMBERS_MANAGE')")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun cancelShop(
        @PathVariable shopId: UUID,
        @AuthenticationPrincipal caller: CurrentUser,
    ) = service.cancelShop(shopId, caller)

    @PostMapping("/v1/shops/{shopId}/ownership-transfer")
    @PreAuthorize("@perm.can(#shopId, 'MEMBERS_MANAGE')")
    fun transfer(
        @PathVariable shopId: UUID,
        @AuthenticationPrincipal caller: CurrentUser,
        @Valid @RequestBody body: OwnershipBody,
    ): OwnershipReceipt = service.transfer(shopId, caller, body.userId, body.code)
}
