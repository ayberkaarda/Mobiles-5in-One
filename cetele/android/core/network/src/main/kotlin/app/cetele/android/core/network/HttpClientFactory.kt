package app.cetele.android.core.network

import app.cetele.android.core.network.auth.AccessTokenHolder
import app.cetele.android.core.network.auth.RefreshCoordinator
import app.cetele.android.core.network.auth.TokenRefresher
import app.cetele.android.core.network.auth.configureBearer
import app.cetele.android.core.network.pinning.CertificatePins
import app.cetele.android.core.network.pinning.PinnedEngineFactory
import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpResponseValidator
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.auth.Auth
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

val ProblemJson: ContentType = ContentType("application", "problem+json")

val NetworkJson: Json =
    Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    }

object HttpClientFactory {
    fun createApiClient(
        config: ApiConfig,
        pins: CertificatePins,
        tokens: AccessTokenHolder,
        refresher: TokenRefresher,
        engine: HttpClientEngine? = null,
    ): HttpClient {
        val coordinator = RefreshCoordinator(tokens, refresher)
        return HttpClient(engine ?: PinnedEngineFactory.create(config, pins)) {
            expectSuccess = false
            followRedirects = false
            install(ContentNegotiation) {
                json(NetworkJson)
                json(NetworkJson, contentType = ProblemJson)
            }
            install(HttpTimeout) {
                connectTimeoutMillis = CONNECT_TIMEOUT_MILLIS
                requestTimeoutMillis = API_REQUEST_TIMEOUT_MILLIS
            }
            install(Auth) { configureBearer(tokens, coordinator) }
            HttpResponseValidator {
                validateResponse { response ->
                    coordinator.onResponse(
                        response.call.request.headers[HttpHeaders.Authorization]
                            ?.removePrefix("Bearer "),
                        response.status.value,
                    )
                }
            }
            defaultRequest {
                url(config.baseUrl)
                headers.append(HttpHeaders.UserAgent, "Cetele-Android/${config.appVersion}")
                contentType(ContentType.Application.Json)
            }
        }
    }

    fun createStorageClient(engine: HttpClientEngine? = null): HttpClient =
        HttpClient(engine ?: OkHttp.create()) {
            expectSuccess = false
            followRedirects = false
            install(HttpTimeout) {
                connectTimeoutMillis = CONNECT_TIMEOUT_MILLIS
                requestTimeoutMillis = STORAGE_REQUEST_TIMEOUT_MILLIS
            }
        }

    private const val CONNECT_TIMEOUT_MILLIS = 10_000L
    private const val API_REQUEST_TIMEOUT_MILLIS = 30_000L
    private const val STORAGE_REQUEST_TIMEOUT_MILLIS = 60_000L
}
