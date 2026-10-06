package app.cetele.android.core.network.api

import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.NetworkJson
import app.cetele.android.core.network.ProblemDetail
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.request
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonObject
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

// Any transport or decoding failure is reported as a network failure; cancellation propagates.
@Suppress("TooGenericExceptionCaught")
internal suspend inline fun <reified T> HttpClient.apiCall(
    noinline configure: HttpRequestBuilder.() -> Unit,
): ApiResult<T> =
    try {
        val response = request(configure)
        if (response.status.isSuccess()) {
            val value = if (T::class == Unit::class) Unit as T else response.body<T>()
            ApiResult.Success(value, response.status.value)
        } else {
            val contentType = response.contentType()?.withoutParameters()
            val text = response.bodyAsText()
            val objectBody = runCatching { NetworkJson.parseToJsonElement(text) as? JsonObject }.getOrNull()
            val isProblem =
                contentType == ContentType("application", "problem+json") ||
                    (contentType == ContentType.Application.Json && objectBody?.containsKey("status") == true)
            val problem =
                if (isProblem) {
                    runCatching {
                        NetworkJson.decodeFromString<ProblemDetail>(
                            text,
                        )
                    }.getOrNull()
                } else {
                    null
                }
            if (problem != null) {
                ApiResult.Failure.Problem(problem, retryAfterSeconds(response.headers[HttpHeaders.RetryAfter]))
            } else {
                ApiResult.Failure.Unexpected(response.status.value)
            }
        }
    } catch (exception: CancellationException) {
        throw exception
    } catch (exception: Exception) {
        ApiResult.Failure.Network(exception)
    }

/** `Retry-After` as delta seconds or an HTTP date, clamped to `0..Int.MAX_VALUE`. */
internal fun retryAfterSeconds(value: String?): Int? {
    val seconds =
        value?.toLongOrNull() ?: value?.let { text ->
            runCatching {
                val until = ZonedDateTime.parse(text, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant()
                java.time.Duration
                    .between(java.time.Instant.now(), until)
                    .seconds
            }.getOrNull()
        }
    return seconds?.coerceIn(0, Int.MAX_VALUE.toLong())?.toInt()
}
