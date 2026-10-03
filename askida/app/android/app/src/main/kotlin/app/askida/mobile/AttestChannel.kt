package app.askida.mobile

import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * Android side of the `askida/attest` channel.
 *
 * Play Integrity is wired in with the anonymous recipient flow (Phase 4).
 * Until then every token request fails with `unsupported`, so the app can
 * never mistake a missing attestation for a successful one.
 */
class AttestChannel(messenger: BinaryMessenger) : MethodChannel.MethodCallHandler {
    private val channel = MethodChannel(messenger, CHANNEL_NAME)

    init {
        channel.setMethodCallHandler(this)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            METHOD_REQUEST_TOKEN -> result.error(
                ERROR_UNSUPPORTED,
                "Device attestation is not available in this build.",
                null,
            )
            else -> result.notImplemented()
        }
    }

    fun dispose() {
        channel.setMethodCallHandler(null)
    }

    companion object {
        const val CHANNEL_NAME = "askida/attest"
        const val METHOD_REQUEST_TOKEN = "requestToken"
        const val ERROR_UNSUPPORTED = "unsupported"
    }
}
