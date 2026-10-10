package app.cetele.android.feature.auth.lock

import android.content.Context
import android.content.ContextWrapper
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

fun Context.fragmentActivity(): FragmentActivity? =
    when (this) {
        is FragmentActivity -> this
        is ContextWrapper -> if (baseContext === this) null else baseContext.fragmentActivity()
        else -> null
    }

fun showBiometricUnlock(
    activity: FragmentActivity,
    title: String,
    fallback: String,
    onSuccess: () -> Unit,
    onUnavailable: () -> Unit,
) {
    val prompt =
        BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    onSuccess()
                }

                override fun onAuthenticationError(
                    errorCode: Int,
                    errString: CharSequence,
                ) {
                    onUnavailable()
                }

                override fun onAuthenticationFailed() {
                    onUnavailable()
                }
            },
        )
    prompt.authenticate(
        BiometricPrompt.PromptInfo
            .Builder()
            .setTitle(title)
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .setNegativeButtonText(fallback)
            .build(),
    )
}
