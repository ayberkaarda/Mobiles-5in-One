package app.cetele.android.core.network.api

import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.di.ApiClient
import app.cetele.android.core.network.dto.auth.OtpRequestBody
import app.cetele.android.core.network.dto.auth.OtpVerifyBody
import app.cetele.android.core.network.dto.auth.RefreshBody
import app.cetele.android.core.network.dto.auth.SignInResponse
import app.cetele.android.core.network.dto.auth.TokenResponse
import io.ktor.client.HttpClient
import io.ktor.client.plugins.auth.AuthCircuitBreaker
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.HttpMethod
import javax.inject.Inject

interface AuthApi {
    suspend fun requestOtp(body: OtpRequestBody): ApiResult<Unit>

    suspend fun verifyOtp(body: OtpVerifyBody): ApiResult<SignInResponse>

    suspend fun refresh(body: RefreshBody): ApiResult<TokenResponse>

    suspend fun logout(): ApiResult<Unit>

    suspend fun requestReauth(): ApiResult<Unit>
}

class KtorAuthApi
    @Inject
    constructor(
        @ApiClient private val client: HttpClient,
    ) : AuthApi {
        override suspend fun requestOtp(body: OtpRequestBody): ApiResult<Unit> =
            client.apiCall {
                method = HttpMethod.Post
                url("v1/auth/otp/request")
                setBody(body)
                attributes.put(AuthCircuitBreaker, Unit)
            }

        override suspend fun verifyOtp(body: OtpVerifyBody): ApiResult<SignInResponse> =
            client.apiCall {
                method = HttpMethod.Post
                url("v1/auth/otp/verify")
                setBody(body)
                attributes.put(AuthCircuitBreaker, Unit)
            }

        override suspend fun refresh(body: RefreshBody): ApiResult<TokenResponse> =
            client.apiCall {
                method = HttpMethod.Post
                url("v1/auth/refresh")
                setBody(body)
                attributes.put(AuthCircuitBreaker, Unit)
            }

        override suspend fun logout(): ApiResult<Unit> =
            client.apiCall {
                method = HttpMethod.Post
                url("v1/auth/logout")
            }

        override suspend fun requestReauth(): ApiResult<Unit> =
            client.apiCall {
                method = HttpMethod.Post
                url("v1/auth/reauth/request")
            }
    }
