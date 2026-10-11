package app.cetele.server.auth.web

import app.cetele.server.account.ReauthAction
import app.cetele.server.account.ReauthVerifier
import app.cetele.server.auth.device.DeviceService
import app.cetele.server.auth.token.RefreshTokenService
import app.cetele.server.security.CurrentUser
import org.springframework.http.HttpStatus
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.time.Clock
import java.time.Instant
import java.util.UUID

data class DeviceSession(
    val id: UUID,
    val model: String,
    val appVersion: String,
    val lastSeenAt: Instant,
    val current: Boolean,
    val signedIn: Boolean,
)

data class DeviceSignOutRequest(
    val code: String = "",
)

@RestController
class DeviceController(
    private val devices: DeviceService,
    private val refresh: RefreshTokenService,
    private val reauth: ReauthVerifier,
    private val tx: TransactionTemplate,
    private val clock: Clock,
) {
    @GetMapping("/v1/me/devices")
    @PreAuthorize("isAuthenticated()")
    fun listDevices(
        @AuthenticationPrincipal caller: CurrentUser,
    ): List<DeviceSession> {
        val signedIn = devices.signedInDeviceIds(caller.userId, clock.instant())
        return devices.list(caller.userId).map {
            DeviceSession(
                checkNotNull(it.id),
                it.model,
                it.appVersion,
                it.lastSeenAt,
                it.deviceId == caller.deviceId,
                it.deviceId in signedIn,
            )
        }
    }

    @PostMapping("/v1/me/devices/{id}/sign-out")
    @PreAuthorize("isAuthenticated()")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun signOutDevice(
        @PathVariable id: UUID,
        @AuthenticationPrincipal caller: CurrentUser,
        @RequestBody body: DeviceSignOutRequest,
    ) {
        val device = devices.findOwned(caller.userId, id)
        val now = clock.instant()
        reauth.require(caller, body.code, now, ReauthAction.DEVICE_SIGN_OUT.scope())
        tx.executeWithoutResult { refresh.revokeDevice(caller.userId, device.deviceId, now) }
    }
}
