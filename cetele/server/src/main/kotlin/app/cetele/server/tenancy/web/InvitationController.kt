package app.cetele.server.tenancy.web

import app.cetele.server.security.CurrentUser
import app.cetele.server.tenancy.invitation.AcceptedInvitation
import app.cetele.server.tenancy.invitation.InvitationService
import app.cetele.server.tenancy.invitation.IssuedInvitation
import io.swagger.v3.oas.annotations.Parameter
import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

@RestController
class InvitationController(
    private val invitations: InvitationService,
) {
    /** Owner invites a phone number; the code is in this response only. */
    @PreAuthorize("@perm.can(#shopId, 'MEMBERS_MANAGE')")
    @PostMapping("/v1/shops/{shopId}/invitations")
    @ResponseStatus(HttpStatus.CREATED)
    fun issue(
        @PathVariable shopId: UUID,
        @Parameter(hidden = true) @AuthenticationPrincipal caller: CurrentUser,
        @Valid @RequestBody body: CreateInvitationRequest,
    ): IssuedInvitation = invitations.issue(shopId, caller, body.phone)

    /**
     * Not shop-scoped in the path: the code selects the shop, and the caller's phone number must
     * be the invited one. Rate limited per user; every rejection is the same 404.
     */
    @PreAuthorize("isAuthenticated()")
    @PostMapping("/v1/invitations/{code}/accept")
    @ResponseStatus(HttpStatus.CREATED)
    fun accept(
        @PathVariable code: String,
        @Parameter(hidden = true) @AuthenticationPrincipal caller: CurrentUser,
    ): AcceptedInvitation = invitations.accept(caller, code)
}
