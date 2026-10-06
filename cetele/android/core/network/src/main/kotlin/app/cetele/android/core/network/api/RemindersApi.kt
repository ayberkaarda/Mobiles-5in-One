package app.cetele.android.core.network.api

import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.di.ApiClient
import app.cetele.android.core.network.dto.reminders.ReminderRequest
import app.cetele.android.core.network.dto.reminders.ReminderResponse
import io.ktor.client.HttpClient
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.HttpMethod
import javax.inject.Inject

interface RemindersApi {
    suspend fun send(
        shopId: String,
        body: ReminderRequest,
    ): ApiResult<ReminderResponse>
}

class KtorRemindersApi
    @Inject
    constructor(
        @ApiClient private val client: HttpClient,
    ) : RemindersApi {
        override suspend fun send(
            shopId: String,
            body: ReminderRequest,
        ): ApiResult<ReminderResponse> =
            client.apiCall {
                method = HttpMethod.Post
                url("v1/shops/${segment(shopId)}/reminders")
                setBody(body)
            }
    }
