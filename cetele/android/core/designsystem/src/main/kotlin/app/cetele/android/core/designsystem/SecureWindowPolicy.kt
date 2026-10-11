package app.cetele.android.core.designsystem

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.Window
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext
import java.util.WeakHashMap

data class SecureWindowPolicy(
    val pinSet: Boolean,
    val sdkInt: Int,
) {
    val recentsScreenshotsEnabled: Boolean get() = !pinSet || sdkInt < RECENTS_API

    private companion object {
        const val RECENTS_API = 33
    }
}

@Composable
fun SecurePinWindow() {
    val context = LocalContext.current
    DisposableEffect(context) {
        val window = context.activity()?.window
        if (window != null) PinWindowProtection.enter(window)
        onDispose {
            if (window != null) PinWindowProtection.leave(window)
        }
    }
}

internal object PinWindowProtection {
    private data class Lease(
        var count: Int,
        val previouslySecure: Boolean,
    )

    private val leases = WeakHashMap<Window, Lease>()

    fun enter(window: Window) {
        val lease = leases[window]
        if (lease != null) {
            lease.count++
        } else {
            leases[window] = Lease(1, window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0)
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }

    fun leave(window: Window) {
        val lease = leases[window] ?: return
        lease.count--
        if (lease.count == 0) {
            leases.remove(window)
            if (!lease.previouslySecure) window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }
}

private fun Context.activity(): Activity? =
    when (this) {
        is Activity -> this
        is ContextWrapper -> baseContext.activity()
        else -> null
    }
