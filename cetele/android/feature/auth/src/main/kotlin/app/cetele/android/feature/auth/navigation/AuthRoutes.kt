package app.cetele.android.feature.auth.navigation

import app.cetele.android.core.data.session.SignOutReason
import kotlinx.serialization.Serializable

object AuthRoutes {
    @Serializable data object Phone

    @Serializable data class Otp(
        val phone: String,
    )

    @Serializable data object PinSetup

    @Serializable data object Lock

    @Serializable data class SessionEnded(
        val reason: SignOutReason,
    )
}

interface AuthNavigation {
    fun onOtpRequested(phone: String)

    fun onPinSetupRequired()

    fun onSignedIn()

    fun onUnlocked()

    fun onSessionEnded(reason: SignOutReason)

    fun onSignIn()

    fun onBack()
}
