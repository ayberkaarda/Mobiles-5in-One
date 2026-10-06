package app.cetele.server.auth.web

import app.cetele.server.auth.AuthService
import app.cetele.server.auth.SessionTokens
import app.cetele.server.config.ClientIp
import app.cetele.server.security.CurrentUser
import app.cetele.server.web.validation.E164Tr
import com.fasterxml.jackson.annotation.JsonProperty
import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Pattern
import jakarta.validation.constraints.Size
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

data class OtpRequestBody(
    @field:E164Tr
    val phone: String,
    val deviceId: UUID,
    /** Optional in the schema so that a missing token is answered with `auth.integrity_required`. */
    val integrityToken: String? = null,
)

data class OtpVerifyBody(
    @field:E164Tr
    val phone: String,
    val deviceId: UUID,
    @field:Pattern(regexp = "^[0-9]{6}$")
    val code: String,
    @field:NotBlank
    @field:Size(max = 100)
    val model: String,
    @field:NotBlank
    @field:Size(max = 32)
    val appVersion: String,
)

data class RefreshBody(
    @field:NotBlank
    @field:Size(max = 128)
    val refreshToken: String,
)

data class UserSummary(
    val id: UUID,
    val displayName: String?,
)

data class SignInResponse(
    val accessToken: String,
    val expiresIn: Long,
    val refreshToken: String,
    val user: UserSummary,
    @get:JsonProperty("isNewUser")
    val isNewUser: Boolean,
)

data class TokenResponse(
    val accessToken: String,
    val expiresIn: Long,
    val refreshToken: String,
) {
    companion object {
        fun of(tokens: SessionTokens) = TokenResponse(tokens.accessToken, tokens.expiresIn, tokens.refreshToken)
    }
}

/** Sign-in endpoints. Request, verify and refresh are public; logout needs an access token. */
@RestController
@RequestMapping("/v1/auth")
class AuthController(
    private val auth: AuthService,
) {
    /** Always 202 with an empty body, whether or not the number belongs to a user. */
    @PostMapping("/otp/request")
    fun requestOtp(
        @Valid @RequestBody body: OtpRequestBody,
        request: HttpServletRequest,
    ): ResponseEntity<Void> {
        auth.requestOtp(body.phone, body.deviceId, body.integrityToken, ClientIp.of(request))
        return ResponseEntity.accepted().build()
    }

    @PostMapping("/otp/verify")
    fun verifyOtp(
        @Valid @RequestBody body: OtpVerifyBody,
        request: HttpServletRequest,
    ): SignInResponse {
        val signIn = auth.verifyOtp(body.phone, body.deviceId, body.code, body.model.trim(), body.appVersion.trim(), ClientIp.of(request))
        return SignInResponse(
            accessToken = signIn.tokens.accessToken,
            expiresIn = signIn.tokens.expiresIn,
            refreshToken = signIn.tokens.refreshToken,
            user = UserSummary(signIn.userId, signIn.displayName),
            isNewUser = signIn.isNewUser,
        )
    }

    @PostMapping("/refresh")
    fun refresh(
        @Valid @RequestBody body: RefreshBody,
        request: HttpServletRequest,
    ): TokenResponse = TokenResponse.of(auth.refresh(body.refreshToken, ClientIp.of(request)))

    @PostMapping("/logout")
    fun logout(
        @AuthenticationPrincipal caller: CurrentUser,
    ): ResponseEntity<Void> {
        auth.logout(caller)
        return ResponseEntity.noContent().build()
    }
}
