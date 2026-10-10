package app.cetele.android.feature.auth.common

import app.cetele.android.core.data.session.DeviceIdentity
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.AuthApi
import app.cetele.android.core.network.dto.auth.OtpRequestBody
import app.cetele.android.core.network.integrity.IntegrityNonce
import app.cetele.android.core.network.integrity.IntegrityResult
import app.cetele.android.core.network.integrity.IntegrityTokenProvider
import javax.inject.Inject

class OtpRequester
    @Inject
    constructor(
        private val api: AuthApi,
        private val identity: DeviceIdentity,
        private val integrity: IntegrityTokenProvider,
    ) {
        suspend fun request(phone: String): OtpRequestResult {
            val deviceId = identity.id()
            return when (val verdict = integrity.token(IntegrityNonce.of(phone, deviceId))) {
                is IntegrityResult.Unavailable -> {
                    OtpRequestResult.Unavailable
                }

                is IntegrityResult.Token -> {
                    if (verdict.value.isBlank()) {
                        OtpRequestResult.Unavailable
                    } else {
                        OtpRequestResult.Response(api.requestOtp(OtpRequestBody(phone, deviceId, verdict.value)))
                    }
                }
            }
        }
    }

sealed interface OtpRequestResult {
    data object Unavailable : OtpRequestResult

    data class Response(
        val result: ApiResult<Unit>,
    ) : OtpRequestResult
}
