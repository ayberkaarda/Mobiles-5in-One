package app.cetele.server.account.web

import app.cetele.server.account.ReauthAction
import app.cetele.server.account.ReauthVerifier
import app.cetele.server.security.CurrentUser
import org.springframework.http.HttpStatus
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

data class ReauthRequest(
    val action: ReauthAction,
    val shopId: UUID? = null,
)

@RestController
class ReauthController(
    private val verifier: ReauthVerifier,
) {
    @PostMapping("/v1/auth/reauth/request")
    @PreAuthorize("isAuthenticated()")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun request(
        @AuthenticationPrincipal caller: CurrentUser,
        @RequestBody body: ReauthRequest,
    ) = verifier.request(caller, body.action, body.shopId)
}
