package app.cetele.android.core.network

import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.http.ContentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

/** Media type of RFC 9457 error bodies. */
val ProblemJson: ContentType = ContentType("application", "problem+json")

/** JSON settings shared by every API call. Unknown fields are tolerated so older apps keep working. */
val NetworkJson: Json =
    Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

/**
 * Builds the API client. No request or response logging is installed: payloads carry phone
 * numbers, names and tokens.
 */
fun createHttpClient(
    config: ApiConfig,
    engine: HttpClientEngine = OkHttp.create(),
): HttpClient =
    HttpClient(engine) {
        expectSuccess = false
        install(ContentNegotiation) {
            json(NetworkJson)
            json(NetworkJson, contentType = ProblemJson)
        }
        defaultRequest {
            url(config.baseUrl)
        }
    }
