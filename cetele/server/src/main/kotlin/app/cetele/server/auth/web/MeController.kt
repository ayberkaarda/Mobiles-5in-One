package app.cetele.server.auth.web

import app.cetele.server.auth.user.Me
import app.cetele.server.auth.user.MeService
import app.cetele.server.security.CurrentUser
import app.cetele.server.web.validation.FieldLimits
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

data class MePatchBody(
    @field:NotBlank
    @field:Size(min = FieldLimits.NAME_MIN, max = FieldLimits.NAME_MAX)
    val displayName: String,
)

@RestController
@RequestMapping("/v1/me")
class MeController(
    private val me: MeService,
) {
    @GetMapping
    fun get(
        @AuthenticationPrincipal caller: CurrentUser,
    ): Me = me.me(caller)

    /** Only `displayName` can be changed; any other property is rejected as unknown. */
    @PatchMapping
    fun patch(
        @AuthenticationPrincipal caller: CurrentUser,
        @Valid @RequestBody body: MePatchBody,
    ): Me = me.rename(caller, body.displayName.trim())
}
