package app.cetele.android.core.network.api

import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.di.ApiClient
import app.cetele.android.core.network.dto.me.AccountDeletionBody
import app.cetele.android.core.network.dto.me.AccountDeletionReceipt
import app.cetele.android.core.network.dto.me.Me
import app.cetele.android.core.network.dto.me.MePatchBody
import io.ktor.client.HttpClient
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.HttpMethod
import javax.inject.Inject

interface MeApi {
    suspend fun me(): ApiResult<Me>

    suspend fun patch(body: MePatchBody): ApiResult<Me>

    suspend fun deleteAccount(body: AccountDeletionBody): ApiResult<AccountDeletionReceipt>

    suspend fun cancelDeletion(): ApiResult<Unit>
}

class KtorMeApi
    @Inject
    constructor(
        @ApiClient private val client: HttpClient,
    ) : MeApi {
        override suspend fun me(): ApiResult<Me> =
            client.apiCall {
                method = HttpMethod.Get
                url("v1/me")
            }

        override suspend fun patch(body: MePatchBody): ApiResult<Me> =
            client.apiCall {
                method = HttpMethod.Patch
                url("v1/me")
                setBody(body)
            }

        override suspend fun deleteAccount(body: AccountDeletionBody): ApiResult<AccountDeletionReceipt> =
            client.apiCall {
                method = HttpMethod.Delete
                url("v1/me")
                setBody(body)
            }

        override suspend fun cancelDeletion(): ApiResult<Unit> =
            client.apiCall {
                method = HttpMethod.Delete
                url("v1/me/deletion")
            }
    }
