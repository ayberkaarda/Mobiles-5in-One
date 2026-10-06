package app.cetele.android.core.network

import app.cetele.android.core.network.api.KtorAuthApi
import app.cetele.android.core.network.auth.AccessTokenHolder
import app.cetele.android.core.network.auth.TokenRefresher
import app.cetele.android.core.network.dto.auth.OtpRequestBody
import app.cetele.android.core.network.pinning.CertificatePins
import io.ktor.client.call.body
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.get
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class HttpClientFactoryTest {
    @Test
    fun `resolves paths against the base URL and decodes problem details`() =
        runTest {
            var requestedUrl = ""
            val engine =
                MockEngine { request ->
                    requestedUrl = request.url.toString()
                    respond(
                        content = """{"title":"Unauthorized","status":401,"code":"auth.required","traceId":"t1"}""",
                        status = HttpStatusCode.Unauthorized,
                        headers = headersOf(HttpHeaders.ContentType, ProblemJson.toString()),
                    )
                }
            val client = testClient(engine, ApiConfig("http://10.0.2.2:60080"))

            val response = client.get("v1/me")
            val problem = response.body<ProblemDetail>()

            assertEquals("http://10.0.2.2:60080/v1/me", requestedUrl)
            assertEquals(401, problem.status)
            assertEquals("auth.required", problem.code)
            assertEquals("t1", problem.traceId)
            client.close()
        }

    @Test
    fun `OTP calls bypass bearer and refresh while retaining API version headers`() =
        runTest {
            val tokens = AccessTokenHolder().apply { accessToken = dummyToken() }
            val refresher =
                object : TokenRefresher {
                    override suspend fun refresh() = error("OTP requests must not refresh the session")

                    override suspend fun onRefreshInvalid() = error("OTP errors must not end the session")
                }
            val engine =
                MockEngine { request ->
                    assertNull(request.headers[HttpHeaders.Authorization])
                    assertEquals("Cetele-Android/0.3.0", request.headers[HttpHeaders.UserAgent])
                    respond("", HttpStatusCode.Accepted)
                }
            HttpClientFactory
                .createApiClient(
                    ApiConfig("https://api.cetele.app"),
                    CertificatePins(false),
                    tokens,
                    refresher,
                    engine,
                ).use { client ->
                    assertEquals(
                        ApiResult.Success(Unit, 202),
                        KtorAuthApi(client).requestOtp(OtpRequestBody("+905321234567", "device", dummyToken())),
                    )
                }
        }
}
