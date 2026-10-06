package app.cetele.android.core.network.api

import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.di.ApiClient
import app.cetele.android.core.network.dto.sync.PullResponse
import app.cetele.android.core.network.dto.sync.PushRequest
import app.cetele.android.core.network.dto.sync.PushResponse
import io.ktor.client.HttpClient
import io.ktor.client.request.parameter
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.HttpMethod
import javax.inject.Inject

interface SyncApi {
    suspend fun push(
        shopId: String,
        body: PushRequest,
    ): ApiResult<PushResponse>

    suspend fun pull(
        shopId: String,
        since: Long,
        limit: Int = 500,
    ): ApiResult<PullResponse>
}

class KtorSyncApi
    @Inject
    constructor(
        @ApiClient private val client: HttpClient,
    ) : SyncApi {
        override suspend fun push(
            shopId: String,
            body: PushRequest,
        ): ApiResult<PushResponse> =
            client.apiCall {
                method = HttpMethod.Post
                url("v1/shops/${segment(shopId)}/sync/push")
                setBody(body)
            }

        override suspend fun pull(
            shopId: String,
            since: Long,
            limit: Int,
        ): ApiResult<PullResponse> =
            client.apiCall {
                method = HttpMethod.Get
                url("v1/shops/${segment(shopId)}/sync/pull")
                parameter("since", since)
                parameter("limit", limit)
            }
    }
