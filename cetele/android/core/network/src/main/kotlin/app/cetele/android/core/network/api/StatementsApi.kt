package app.cetele.android.core.network.api

import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.di.ApiClient
import app.cetele.android.core.network.dto.statements.StatementLinkRequest
import app.cetele.android.core.network.dto.statements.StatementLinkResponse
import io.ktor.client.HttpClient
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.HttpMethod
import javax.inject.Inject

interface StatementsApi {
    suspend fun createLink(
        shopId: String,
        body: StatementLinkRequest,
    ): ApiResult<StatementLinkResponse>

    suspend fun pdf(
        shopId: String,
        customerId: String,
    ): ApiResult<ByteArray>
}

class KtorStatementsApi
    @Inject
    constructor(
        @ApiClient private val client: HttpClient,
    ) : StatementsApi {
        override suspend fun createLink(
            shopId: String,
            body: StatementLinkRequest,
        ): ApiResult<StatementLinkResponse> =
            client.apiCall {
                method = HttpMethod.Post
                url("v1/shops/${segment(shopId)}/statement-links")
                setBody(body)
            }

        override suspend fun pdf(
            shopId: String,
            customerId: String,
        ): ApiResult<ByteArray> =
            client.apiCall {
                method = HttpMethod.Get
                url("v1/shops/${segment(shopId)}/customers/${segment(customerId)}/statement.pdf")
            }
    }
