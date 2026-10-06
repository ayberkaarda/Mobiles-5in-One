package app.cetele.server.security

import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import app.cetele.server.web.validation.E164Tr
import app.cetele.server.web.validation.FieldLimits
import io.swagger.v3.oas.annotations.Hidden
import jakarta.validation.Valid
import jakarta.validation.constraints.Max
import jakarta.validation.constraints.Min
import jakarta.validation.constraints.Size
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.stereotype.Component
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

/**
 * Test-only endpoints that exercise the platform behaviour (errors, validation, principal,
 * method security) before the real controllers exist. Hidden from the OpenAPI document.
 */
@Hidden
@RestController
@RequestMapping(ProbeController.BASE)
class ProbeController {
    @GetMapping("/me")
    fun me(
        @AuthenticationPrincipal user: CurrentUser,
    ): Map<String, String> = mapOf("userId" to user.userId.toString(), "deviceId" to user.deviceId.toString())

    @GetMapping("/boom")
    fun boom(): Nothing = throw IllegalStateException("boom for " + PROBE_DETAIL_MARKER)

    @GetMapping("/rate-limited")
    fun rateLimited(): Nothing = throw ProblemException(ProblemCode.RATE_LIMITED, "probe", headers = mapOf("Retry-After" to "42"))

    @PostMapping("/echo")
    fun echo(
        @Valid @RequestBody body: ProbeBody,
    ): Map<String, Boolean> = mapOf("ok" to true)

    @GetMapping("/items/{itemId}")
    fun item(
        @PathVariable itemId: UUID,
    ): Map<String, String> = mapOf("id" to itemId.toString())

    @PreAuthorize("denyAll()")
    @GetMapping("/denied")
    fun denied(): Map<String, Boolean> = mapOf("ok" to true)

    @PreAuthorize("@probePerm.can(#shopId)")
    @GetMapping("/shops/{shopId}")
    fun shop(
        @PathVariable shopId: UUID,
    ): Map<String, String> = mapOf("id" to shopId.toString())

    companion object {
        const val BASE = "/v1/test-probe"
        const val PROBE_DETAIL_MARKER = "internal-detail-7f3"
    }
}

data class ProbeBody(
    @field:E164Tr
    val phone: String,
    @field:Size(min = FieldLimits.NAME_MIN, max = FieldLimits.NAME_MAX)
    val name: String,
    @field:Min(1)
    @field:Max(100)
    val amount: Long? = null,
)

/** Mirrors the tenancy evaluator contract: no membership throws not_found, so 404 wins over 403. */
@Component("probePerm")
class ProbePermission {
    fun can(shopId: UUID): Boolean {
        if (shopId == MEMBER_SHOP) return false
        throw ProblemException(ProblemCode.NOT_FOUND, "no membership")
    }

    companion object {
        val MEMBER_SHOP: UUID = UUID(0L, 1L)
    }
}
