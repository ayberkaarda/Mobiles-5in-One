package app.cetele.server.tenancy.web

import app.cetele.server.security.CurrentUser
import app.cetele.server.tenancy.membership.MemberService
import app.cetele.server.tenancy.membership.MemberView
import io.swagger.v3.oas.annotations.Parameter
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

data class MemberList(
    val members: List<MemberView>,
)

/** Member management is owner-only (`MEMBERS_MANAGE`); staff cannot even list members. */
@RestController
@RequestMapping("/v1/shops/{shopId}/members")
class MemberController(
    private val members: MemberService,
) {
    @PreAuthorize("@perm.can(#shopId, 'MEMBERS_MANAGE')")
    @GetMapping
    fun list(
        @PathVariable shopId: UUID,
        @Parameter(hidden = true) @AuthenticationPrincipal caller: CurrentUser,
    ): MemberList = MemberList(members.list(shopId, caller))

    @PreAuthorize("@perm.can(#shopId, 'MEMBERS_MANAGE')")
    @DeleteMapping("/{userId}")
    fun remove(
        @PathVariable shopId: UUID,
        @PathVariable userId: UUID,
        @Parameter(hidden = true) @AuthenticationPrincipal caller: CurrentUser,
    ): ResponseEntity<Void> {
        members.remove(shopId, caller, userId)
        return ResponseEntity.noContent().build()
    }
}
