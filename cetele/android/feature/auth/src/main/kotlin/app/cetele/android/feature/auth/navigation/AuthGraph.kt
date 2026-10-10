package app.cetele.android.feature.auth.navigation

import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import androidx.navigation.toRoute
import app.cetele.android.core.data.session.SignOutReason
import app.cetele.android.feature.auth.lock.LockScreen
import app.cetele.android.feature.auth.lock.LockViewModel
import app.cetele.android.feature.auth.lock.rememberBiometricUnlockAction
import app.cetele.android.feature.auth.otp.OtpDestination
import app.cetele.android.feature.auth.otp.OtpScreen
import app.cetele.android.feature.auth.otp.OtpViewModel
import app.cetele.android.feature.auth.phone.PhoneScreen
import app.cetele.android.feature.auth.phone.PhoneViewModel
import app.cetele.android.feature.auth.pinsetup.PinSetupScreen
import app.cetele.android.feature.auth.pinsetup.PinSetupViewModel
import app.cetele.android.feature.auth.sessionended.SessionEndedScreen

fun NavGraphBuilder.authGraph(nav: AuthNavigation) {
    composable<AuthRoutes.Phone> {
        val model = hiltViewModel<PhoneViewModel>()
        val state by model.state.collectAsStateWithLifecycle()
        LaunchedEffect(state.requestedPhone) {
            state.requestedPhone?.let { phone ->
                nav.onOtpRequested(phone)
                model.navigationHandled()
            }
        }
        PhoneScreen(state, model::edit, model::send)
    }
    composable<AuthRoutes.Otp> {
        val model = hiltViewModel<OtpViewModel>()
        val state by model.state.collectAsStateWithLifecycle()
        LaunchedEffect(state.destination) {
            when (state.destination) {
                OtpDestination.PinSetup -> nav.onPinSetupRequired()
                OtpDestination.SignedIn -> nav.onSignedIn()
                null -> Unit
            }
        }
        OtpScreen(state, { model.submit(it, Build.MODEL) }, model::resend, nav::onBack)
    }
    composable<AuthRoutes.PinSetup> {
        val model = hiltViewModel<PinSetupViewModel>()
        val state by model.state.collectAsStateWithLifecycle()
        BackHandler { }
        LaunchedEffect(state.complete) { if (state.complete) nav.onSignedIn() }
        PinSetupScreen(state, model::enter, model::enableBiometric)
    }
    composable<AuthRoutes.Lock> {
        val model = hiltViewModel<LockViewModel>()
        val state by model.state.collectAsStateWithLifecycle()
        BackHandler { }
        LaunchedEffect(state.unlocked) { if (state.unlocked) nav.onUnlocked() }
        LaunchedEffect(state.signedOut) { if (state.signedOut) nav.onSessionEnded(SignOutReason.USER) }
        LockScreen(
            state,
            model::enter,
            rememberBiometricUnlockAction(model::biometricSucceeded, model::biometricUnavailable),
            model::forgotPin,
            model::confirmSignOut,
            model::dismissSignOut,
        )
    }
    composable<AuthRoutes.SessionEnded> { entry ->
        BackHandler { }
        SessionEndedScreen(entry.toRoute<AuthRoutes.SessionEnded>().reason, nav::onSignIn)
    }
}
