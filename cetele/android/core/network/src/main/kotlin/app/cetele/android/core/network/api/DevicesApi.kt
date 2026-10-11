package app.cetele.android.core.network.api

import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.di.ApiClient
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.ktor.client.HttpClient
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.HttpMethod
import kotlinx.serialization.Serializable
import javax.inject.Inject

@Serializable
data class DeviceSession(
    val id: String,
    val model: String,
    val appVersion: String,
    val lastSeenAt: String,
    val current: Boolean,
    val signedIn: Boolean,
)

@Serializable
data class DeviceSignOutBody(
    val code: String,
) {
    override fun toString(): String = "DeviceSignOutBody(code=[redacted])"
}

interface DevicesApi {
    suspend fun list(): ApiResult<List<DeviceSession>>

    suspend fun signOut(
        id: String,
        body: DeviceSignOutBody,
    ): ApiResult<Unit>
}

class KtorDevicesApi
    @Inject
    constructor(
        @ApiClient private val client: HttpClient,
    ) : DevicesApi {
        override suspend fun list(): ApiResult<List<DeviceSession>> =
            client.apiCall {
                method = HttpMethod.Get
                url("v1/me/devices")
            }

        override suspend fun signOut(
            id: String,
            body: DeviceSignOutBody,
        ): ApiResult<Unit> =
            client.apiCall {
                method = HttpMethod.Post
                url("v1/me/devices/$id/sign-out")
                setBody(body)
            }
    }

@Module
@InstallIn(SingletonComponent::class)
abstract class DevicesApiModule {
    @Binds
    abstract fun devices(api: KtorDevicesApi): DevicesApi
}
