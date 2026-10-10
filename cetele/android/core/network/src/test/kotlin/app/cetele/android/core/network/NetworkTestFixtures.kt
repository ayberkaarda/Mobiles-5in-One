package app.cetele.android.core.network

import app.cetele.android.core.network.auth.AccessTokenHolder
import app.cetele.android.core.network.auth.TokenRefresher
import io.ktor.client.engine.mock.MockEngine
import io.ktor.http.HttpHeaders
import io.ktor.http.headersOf
import java.util.UUID

internal fun dummyToken(): String = UUID.randomUUID().toString()

internal val jsonHeaders = headersOf(HttpHeaders.ContentType, "application/json")
internal val unauthorizedHeaders =
    headersOf(
        HttpHeaders.ContentType to listOf("application/problem+json"),
        HttpHeaders.WWWAuthenticate to listOf("Bearer"),
    )

internal fun testClient(
    engine: MockEngine,
    config: ApiConfig = ApiConfig("https://api.cetele.app"),
) = HttpClientFactory.createApiClient(
    config,
    app.cetele.android.core.network.pinning
        .CertificatePins(false),
    AccessTokenHolder(),
    object : TokenRefresher {
        override suspend fun refresh() = ApiResult.Failure.Unexpected(401)

        override suspend fun onRefreshInvalid() = Unit
    },
    engine,
)
