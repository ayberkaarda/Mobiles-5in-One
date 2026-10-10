package app.cetele.android.integrity

import android.content.Context
import app.cetele.android.core.network.integrity.IntegrityResult
import app.cetele.android.core.network.integrity.IntegrityTokenProvider
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.IntegrityTokenRequest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

class PlayIntegrityTokenProvider(
    context: Context,
) : IntegrityTokenProvider {
    private val manager = IntegrityManagerFactory.create(context.applicationContext)

    override suspend fun token(nonce: String): IntegrityResult =
        try {
            suspendCancellableCoroutine { continuation ->
                manager
                    .requestIntegrityToken(IntegrityTokenRequest.builder().setNonce(nonce).build())
                    .addOnSuccessListener { response ->
                        if (continuation.isActive) continuation.resume(IntegrityResult.Token(response.token()))
                    }.addOnFailureListener {
                        if (continuation.isActive) {
                            continuation.resume(
                                IntegrityResult.Unavailable("integrity.unavailable"),
                            )
                        }
                    }
            }
        } catch (exception: CancellationException) {
            throw exception
        } catch (_: Exception) {
            IntegrityResult.Unavailable("integrity.unavailable")
        }
}
