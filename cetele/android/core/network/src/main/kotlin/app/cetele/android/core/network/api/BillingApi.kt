package app.cetele.android.core.network.api

import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.di.ApiClient
import app.cetele.android.core.network.dto.billing.BillingState
import app.cetele.android.core.network.dto.billing.LinkPurchaseRequest
import io.ktor.client.HttpClient
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.HttpMethod
import javax.inject.Inject

/** Plan, limits and subscription of a shop, and linking a Play purchase to it (ADR-0031). */
interface BillingApi {
    suspend fun state(shopId: String): ApiResult<BillingState>

    suspend fun link(
        shopId: String,
        body: LinkPurchaseRequest,
    ): ApiResult<BillingState>
}

class KtorBillingApi
    @Inject
    constructor(
        @ApiClient private val client: HttpClient,
    ) : BillingApi {
        override suspend fun state(shopId: String): ApiResult<BillingState> =
            client.apiCall {
                method = HttpMethod.Get
                url("v1/shops/${segment(shopId)}/billing")
            }

        override suspend fun link(
            shopId: String,
            body: LinkPurchaseRequest,
        ): ApiResult<BillingState> =
            client.apiCall {
                method = HttpMethod.Post
                url("v1/shops/${segment(shopId)}/billing/link")
                setBody(body)
            }
    }
