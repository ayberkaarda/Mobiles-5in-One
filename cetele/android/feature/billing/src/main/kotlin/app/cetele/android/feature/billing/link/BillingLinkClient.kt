package app.cetele.android.feature.billing.link

import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.BillingApi
import app.cetele.android.core.network.dto.billing.BillingState
import app.cetele.android.core.network.dto.billing.LinkPurchaseRequest
import app.cetele.android.feature.billing.BillingProduct
import javax.inject.Inject

/** Outcome of one `POST billing/link` call. */
sealed interface LinkAttempt {
    data class Linked(
        val state: BillingState,
    ) : LinkAttempt

    /** `503`, `429`, a server error, a timeout or no network: try again later with the same token. */
    data class Retry(
        val retryAfterSeconds: Int?,
    ) : LinkAttempt

    /** `409`, `422`, `403`, `404` and every other refusal: the token is not sent again. */
    data class Final(
        val code: String?,
    ) : LinkAttempt
}

/** Sends a purchase token to the server and refreshes the shop list after a link, so the plan follows. */
class BillingLinkClient
    @Inject
    constructor(
        private val api: BillingApi,
        private val shops: ShopRepository,
    ) {
        suspend fun attempt(
            shopId: String,
            purchaseToken: String,
        ): LinkAttempt {
            val result = api.link(shopId, LinkPurchaseRequest(BillingProduct.PRODUCT_ID, purchaseToken))
            if (result is ApiResult.Success) shops.refresh()
            return classify(result)
        }

        companion object {
            private const val TOO_MANY_REQUESTS = 429
            private const val SERVER_ERRORS = 500

            fun classify(result: ApiResult<BillingState>): LinkAttempt =
                when (result) {
                    is ApiResult.Success -> {
                        LinkAttempt.Linked(result.value)
                    }

                    is ApiResult.Failure.Network -> {
                        LinkAttempt.Retry(null)
                    }

                    is ApiResult.Failure.Unexpected -> {
                        if (retryable(result.status)) LinkAttempt.Retry(null) else LinkAttempt.Final(null)
                    }

                    is ApiResult.Failure.Problem -> {
                        if (retryable(result.problem.status)) {
                            LinkAttempt.Retry(result.retryAfterSeconds)
                        } else {
                            LinkAttempt.Final(result.problem.code)
                        }
                    }
                }

            private fun retryable(status: Int): Boolean = status == TOO_MANY_REQUESTS || status >= SERVER_ERRORS
        }
    }
