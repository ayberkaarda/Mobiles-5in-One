package app.askida.mobile

import android.content.Context
import android.util.Base64
import com.google.android.play.core.integrity.IntegrityManager
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.IntegrityServiceException
import com.google.android.play.core.integrity.IntegrityTokenRequest
import com.google.android.play.core.integrity.model.IntegrityErrorCode
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.security.MessageDigest

/**
 * Android side of the `askida/attest` channel: a Play Integrity token from
 * the classic request API, bound to the anonymous identity request.
 *
 * The Dart side passes the `device_nonce` it sends to `POST anon/attest`.
 * Play Integrity gets SHA-256 of that value, base64url without padding
 * (43 characters, inside the API's 16..500 limit), so the server can check
 * the nonce inside the verdict against the request it received.
 *
 * No key or project secret ships with the app: the token is opaque here
 * and is decoded only by the server. Failures are reported with the codes
 * the Dart side understands:
 * - `unsupported`: no Play Store / Play services, or the API is not
 *   available on this device;
 * - `unavailable`: a provider exists but cannot answer right now
 *   (network, quota, transient errors, app not installed from Play);
 * - `unknown`: anything else, including nonce errors.
 * The dev flavor turns `unsupported`/`unavailable` into its fixed dev token
 * on the Dart side; the prod flavor shows a blocking message.
 */
class AttestChannel(
    context: Context,
    messenger: BinaryMessenger,
    private val integrity: IntegrityManager =
        IntegrityManagerFactory.create(context.applicationContext),
) : MethodChannel.MethodCallHandler {
    private val channel = MethodChannel(messenger, CHANNEL_NAME)

    init {
        channel.setMethodCallHandler(this)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            METHOD_REQUEST_TOKEN -> requestToken(call.argument<String>(ARG_NONCE), result)
            else -> result.notImplemented()
        }
    }

    private fun requestToken(deviceNonce: String?, result: MethodChannel.Result) {
        if (deviceNonce == null || deviceNonce.isEmpty()) {
            result.error(ERROR_UNKNOWN, "A device nonce is required.", null)
            return
        }
        val request = IntegrityTokenRequest.builder()
            .setNonce(integrityNonce(deviceNonce))
            .build()
        try {
            integrity.requestIntegrityToken(request)
                .addOnSuccessListener { response -> result.success(response.token()) }
                .addOnFailureListener { error -> reportFailure(error, result) }
        } catch (error: RuntimeException) {
            reportFailure(error, result)
        }
    }

    private fun reportFailure(error: Exception, result: MethodChannel.Result) {
        val code = if (error is IntegrityServiceException) {
            failureCode(error.errorCode)
        } else {
            ERROR_UNAVAILABLE
        }
        // The provider's message can carry device details: only the code
        // and a fixed text cross the channel.
        result.error(code, "Play Integrity could not provide a token.", null)
    }

    fun dispose() {
        channel.setMethodCallHandler(null)
    }

    companion object {
        const val CHANNEL_NAME = "askida/attest"
        const val METHOD_REQUEST_TOKEN = "requestToken"
        const val ARG_NONCE = "nonce"
        const val ERROR_UNSUPPORTED = "unsupported"
        const val ERROR_UNAVAILABLE = "unavailable"
        const val ERROR_UNKNOWN = "unknown"

        /** SHA-256 of the device nonce, base64url without padding or wrap. */
        fun integrityNonce(deviceNonce: String): String {
            val digest = MessageDigest.getInstance("SHA-256")
                .digest(deviceNonce.toByteArray(Charsets.UTF_8))
            return Base64.encodeToString(
                digest,
                Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
            )
        }

        /** Maps a Play Integrity error code to a channel failure code. */
        fun failureCode(errorCode: Int): String = when (errorCode) {
            IntegrityErrorCode.API_NOT_AVAILABLE,
            IntegrityErrorCode.PLAY_STORE_NOT_FOUND,
            IntegrityErrorCode.PLAY_SERVICES_NOT_FOUND,
            IntegrityErrorCode.PLAY_STORE_VERSION_OUTDATED,
            IntegrityErrorCode.PLAY_SERVICES_VERSION_OUTDATED,
            -> ERROR_UNSUPPORTED

            IntegrityErrorCode.NETWORK_ERROR,
            IntegrityErrorCode.TOO_MANY_REQUESTS,
            IntegrityErrorCode.GOOGLE_SERVER_UNAVAILABLE,
            IntegrityErrorCode.INTERNAL_ERROR,
            IntegrityErrorCode.CANNOT_BIND_TO_SERVICE,
            IntegrityErrorCode.CLIENT_TRANSIENT_ERROR,
            IntegrityErrorCode.APP_NOT_INSTALLED,
            IntegrityErrorCode.APP_UID_MISMATCH,
            IntegrityErrorCode.PLAY_STORE_ACCOUNT_NOT_FOUND,
            IntegrityErrorCode.CLOUD_PROJECT_NUMBER_IS_INVALID,
            -> ERROR_UNAVAILABLE

            else -> ERROR_UNKNOWN
        }
    }
}
