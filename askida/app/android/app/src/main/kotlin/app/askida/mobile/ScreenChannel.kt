package app.askida.mobile

import android.app.Activity
import android.view.WindowManager
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * `askida/screen`: full brightness while a code is shown to the shop.
 *
 * Only this window is changed (no system setting, no permission): the
 * brightness override and keep-screen-on are set while enabled and cleared
 * when the code view closes.
 */
class ScreenChannel(
    private val activity: Activity,
    messenger: BinaryMessenger,
) : MethodChannel.MethodCallHandler {
    private val channel = MethodChannel(messenger, CHANNEL_NAME)

    init {
        channel.setMethodCallHandler(this)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            METHOD_SET_FULL -> {
                setFullBrightness(call.argument<Boolean>(ARG_ENABLED) == true)
                result.success(null)
            }
            else -> result.notImplemented()
        }
    }

    private fun setFullBrightness(enabled: Boolean) {
        val window = activity.window
        val attributes = window.attributes
        attributes.screenBrightness = if (enabled) {
            WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_FULL
        } else {
            WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
        }
        window.attributes = attributes
        if (enabled) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    fun dispose() {
        channel.setMethodCallHandler(null)
    }

    companion object {
        const val CHANNEL_NAME = "askida/screen"
        const val METHOD_SET_FULL = "setFullBrightness"
        const val ARG_ENABLED = "enabled"
    }
}
