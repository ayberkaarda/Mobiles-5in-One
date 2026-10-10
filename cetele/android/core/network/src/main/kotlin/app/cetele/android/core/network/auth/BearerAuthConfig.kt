package app.cetele.android.core.network.auth

import io.ktor.client.plugins.auth.AuthConfig
import io.ktor.client.plugins.auth.providers.BearerTokens
import io.ktor.client.plugins.auth.providers.bearer
import io.ktor.http.encodedPath

internal fun AuthConfig.configureBearer(
    tokens: AccessTokenHolder,
    coordinator: RefreshCoordinator,
) {
    bearer {
        loadTokens { tokens.accessToken?.let { BearerTokens(it, "") } }
        refreshTokens {
            coordinator.refresh(oldTokens?.accessToken)?.let { BearerTokens(it, "") }
        }
        sendWithoutRequest { request ->
            PUBLIC_AUTH_PATHS.none(request.url.encodedPath::endsWith)
        }
        cacheTokens = false
    }
}

internal val PUBLIC_AUTH_PATHS = setOf("/v1/auth/otp/request", "/v1/auth/otp/verify", "/v1/auth/refresh")
