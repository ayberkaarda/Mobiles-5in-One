package app.cetele.android.core.network

import app.cetele.android.core.network.api.KtorAuthApi
import app.cetele.android.core.network.api.KtorMeApi
import app.cetele.android.core.network.auth.AccessTokenHolder
import app.cetele.android.core.network.auth.RefreshCoordinator
import app.cetele.android.core.network.auth.SessionEvent
import app.cetele.android.core.network.auth.TokenRefresher
import app.cetele.android.core.network.dto.auth.RefreshBody
import app.cetele.android.core.network.dto.auth.TokenResponse
import app.cetele.android.core.network.pinning.CertificatePins
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import java.util.concurrent.atomic.AtomicInteger

@OptIn(ExperimentalCoroutinesApi::class)
class BearerRefreshTest {
    @Test
    fun `HTTP refresh invalid does not authenticate or recursively refresh`() =
        runTest {
            val tokens = AccessTokenHolder().apply { accessToken = dummyToken() }
            var invalidations = 0
            var refreshes = 0
            lateinit var client: HttpClient
            val refresher =
                object : TokenRefresher {
                    override suspend fun refresh(): ApiResult<TokenResponse> {
                        refreshes++
                        return KtorAuthApi(client).refresh(RefreshBody(dummyToken()))
                    }

                    override suspend fun onRefreshInvalid() {
                        invalidations++
                    }
                }
            val engine =
                MockEngine { request ->
                    val code =
                        if (request.url.encodedPath == "/v1/auth/refresh") {
                            assertNull(request.headers[HttpHeaders.Authorization])
                            "auth.refresh_invalid"
                        } else {
                            "auth.unauthenticated"
                        }
                    respond(
                        """{"title":"Unauthorized","status":401,"code":"$code"}""",
                        HttpStatusCode.Unauthorized,
                        unauthorizedHeaders,
                    )
                }
            client =
                HttpClientFactory.createApiClient(
                    ApiConfig("https://api.cetele.app"),
                    CertificatePins(false),
                    tokens,
                    refresher,
                    engine,
                )
            client.use {
                assertEquals("auth.unauthenticated", KtorMeApi(client).me().problemCode)
                assertEquals("auth.unauthenticated", KtorMeApi(client).me().problemCode)
                assertEquals(1, refreshes)
                assertEquals(1, invalidations)
                assertNull(tokens.accessToken)
            }
        }

    @Test
    fun `sign out during refresh prevents token restoration`() =
        runTest {
            val tokens = AccessTokenHolder().apply { accessToken = dummyToken() }
            val started = CompletableDeferred<Unit>()
            val finish = CompletableDeferred<Unit>()
            val coordinator =
                RefreshCoordinator(
                    tokens,
                    object : TokenRefresher {
                        override suspend fun refresh(): ApiResult<TokenResponse> {
                            started.complete(Unit)
                            finish.await()
                            return ApiResult.Success(TokenResponse(dummyToken(), 900, dummyToken()), 200)
                        }

                        override suspend fun onRefreshInvalid() {
                            error("Explicit sign out does not expire refresh credentials")
                        }
                    },
                )
            val old = tokens.accessToken
            val refreshing = async { coordinator.refresh(old) }
            started.await()
            tokens.clear()
            finish.complete(Unit)
            assertNull(refreshing.await())
            assertNull(tokens.accessToken)
        }

    @Test
    fun `two concurrent unauthorized calls share one refresh and retry successfully`() =
        runTest {
            val old = dummyToken()
            val fresh = dummyToken()
            val refresh = dummyToken()
            val requests = AtomicInteger()
            val refreshes = AtomicInteger()
            val bothUnauthorized = CompletableDeferred<Unit>()
            val tokens = AccessTokenHolder().apply { accessToken = old }
            lateinit var client: HttpClient
            val refresher =
                object : TokenRefresher {
                    override suspend fun refresh(): ApiResult<TokenResponse> {
                        refreshes.incrementAndGet()
                        return KtorAuthApi(client).refresh(RefreshBody(refresh))
                    }

                    override suspend fun onRefreshInvalid() {
                        error("Successful refresh must keep the session")
                    }
                }
            val engine =
                MockEngine { request ->
                    when {
                        request.url.encodedPath == "/v1/auth/refresh" -> {
                            assertNull(request.headers[HttpHeaders.Authorization])
                            respond(
                                """{"accessToken":"$fresh","expiresIn":900,"refreshToken":"$refresh"}""",
                                headers = jsonHeaders,
                            )
                        }

                        request.headers[HttpHeaders.Authorization] == "Bearer $old" -> {
                            if (requests.incrementAndGet() == 2) bothUnauthorized.complete(Unit)
                            bothUnauthorized.await()
                            respond(
                                """{"title":"Unauthorized","status":401,"code":"auth.unauthenticated"}""",
                                HttpStatusCode.Unauthorized,
                                unauthorizedHeaders,
                            )
                        }

                        else -> {
                            assertEquals("Bearer $fresh", request.headers[HttpHeaders.Authorization])
                            respond("""{"id":"u1","phone":"+905321234567","memberships":[]}""", headers = jsonHeaders)
                        }
                    }
                }
            client =
                HttpClientFactory.createApiClient(
                    ApiConfig("https://api.cetele.app"),
                    CertificatePins(false),
                    tokens,
                    refresher,
                    engine,
                )
            client.use {
                val first = async { KtorMeApi(client).me() }
                val second = async { KtorMeApi(client).me() }
                assertEquals("u1", first.await().getOrNull()?.id)
                assertEquals("u1", second.await().getOrNull()?.id)
                assertEquals(1, refreshes.get())
                assertEquals(fresh, tokens.accessToken)
            }
        }

    @Test
    fun `refresh invalid emits once and clears the access token`() =
        runTest {
            val tokens = AccessTokenHolder().apply { accessToken = dummyToken() }
            val old = tokens.accessToken
            var invalidations = 0
            var refreshes = 0
            val coordinator =
                RefreshCoordinator(
                    tokens,
                    object : TokenRefresher {
                        override suspend fun refresh(): ApiResult<TokenResponse> {
                            refreshes++
                            return ApiResult.Failure.Problem(
                                ProblemDetail(title = "Invalid", status = 401, code = "auth.refresh_invalid"),
                            )
                        }

                        override suspend fun onRefreshInvalid() {
                            invalidations++
                        }
                    },
                )
            val events =
                backgroundScope.async(
                    UnconfinedTestDispatcher(testScheduler),
                ) { coordinator.events.take(1).toList() }
            assertNull(coordinator.refresh(old))
            assertNull(coordinator.refresh(old))
            assertEquals(listOf(SessionEvent.RefreshInvalid), events.await())
            assertEquals(1, invalidations)
            assertEquals(1, refreshes)
            assertNull(tokens.accessToken)
        }

    @Test
    fun `a repeated unauthorized response after refresh ends the session once`() =
        runTest {
            val tokens = AccessTokenHolder().apply { accessToken = dummyToken() }
            var invalidations = 0
            var refreshes = 0
            val refresher =
                object : TokenRefresher {
                    override suspend fun refresh(): ApiResult<TokenResponse> {
                        refreshes++
                        return ApiResult.Success(TokenResponse(dummyToken(), 900, dummyToken()), 200)
                    }

                    override suspend fun onRefreshInvalid() {
                        invalidations++
                    }
                }
            val engine =
                MockEngine {
                    respond(
                        """{"title":"Unauthorized","status":401,"code":"auth.unauthenticated"}""",
                        HttpStatusCode.Unauthorized,
                        unauthorizedHeaders,
                    )
                }
            HttpClientFactory
                .createApiClient(
                    ApiConfig("https://api.cetele.app"),
                    CertificatePins(false),
                    tokens,
                    refresher,
                    engine,
                ).use { client ->
                    assertEquals("auth.unauthenticated", KtorMeApi(client).me().problemCode)
                    assertEquals(1, refreshes)
                    assertEquals(1, invalidations)
                    assertNull(tokens.accessToken)
                }
        }

    @Test
    fun `a refreshed token that expires later is refreshed again instead of ending the session`() =
        runTest {
            val first = dummyToken()
            val issued = ArrayDeque(listOf(dummyToken(), dummyToken()))
            val accepted = mutableSetOf<String>()
            val tokens = AccessTokenHolder().apply { accessToken = first }
            var invalidations = 0
            var refreshes = 0
            val refresher =
                object : TokenRefresher {
                    override suspend fun refresh(): ApiResult<TokenResponse> {
                        refreshes++
                        val next = issued.removeFirst()
                        accepted += next
                        return ApiResult.Success(TokenResponse(next, 900, dummyToken()), 200)
                    }

                    override suspend fun onRefreshInvalid() {
                        invalidations++
                    }
                }
            val engine =
                MockEngine { request ->
                    val bearer = request.headers[HttpHeaders.Authorization]?.removePrefix("Bearer ")
                    if (bearer != null && bearer in accepted) {
                        respond("""{"id":"u1","phone":"+905321234567","memberships":[]}""", headers = jsonHeaders)
                    } else {
                        respond(
                            """{"title":"Unauthorized","status":401,"code":"auth.unauthenticated"}""",
                            HttpStatusCode.Unauthorized,
                            unauthorizedHeaders,
                        )
                    }
                }
            HttpClientFactory
                .createApiClient(
                    ApiConfig("https://api.cetele.app"),
                    CertificatePins(false),
                    tokens,
                    refresher,
                    engine,
                ).use { client ->
                    assertEquals("u1", KtorMeApi(client).me().getOrNull()?.id)
                    // The server stops accepting the refreshed token (natural expiry).
                    accepted.clear()
                    accepted += issued.first()
                    assertEquals("u1", KtorMeApi(client).me().getOrNull()?.id)
                    assertEquals(2, refreshes)
                    assertEquals(0, invalidations)
                }
        }
}
