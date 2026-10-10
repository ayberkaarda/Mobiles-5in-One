package app.cetele.android.core.network

import app.cetele.android.core.network.api.KtorAuthApi
import app.cetele.android.core.network.dto.auth.OtpRequestBody
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.io.IOException

class ApiResultTest {
    private val body = OtpRequestBody("+905321234567", "device", dummyToken())

    @Test
    fun `all successful status codes accept an empty body`() =
        runTest {
            for (status in listOf(200, 201, 202, 204)) {
                testClient(MockEngine { respond("", HttpStatusCode.fromValue(status)) }).use { client ->
                    assertEquals(ApiResult.Success(Unit, status), KtorAuthApi(client).requestOtp(body))
                }
            }
        }

    @Test
    fun `problem details keep field codes trace and retry delay`() =
        runTest {
            testClient(
                MockEngine {
                    respond(
                        """{"title":"Limit","status":429,"code":"rate_limited","traceId":"t1",""" +
                            """"errors":[{"field":"phone","code":"invalid_format"}]}""",
                        HttpStatusCode.TooManyRequests,
                        headersOf(
                            HttpHeaders.ContentType to listOf("application/problem+json"),
                            HttpHeaders.RetryAfter to listOf("17"),
                        ),
                    )
                },
            ).use { client ->
                val result = KtorAuthApi(client).requestOtp(body) as ApiResult.Failure.Problem
                assertEquals("rate_limited", result.problemCode)
                assertEquals(17, result.retryAfterSeconds)
                assertEquals("t1", result.problem.traceId)
                assertEquals(
                    "invalid_format",
                    result.problem.errors
                        .single()
                        .code,
                )
            }
        }

    @Test
    fun `JSON with status is a problem but HTML and unrelated JSON are unexpected`() =
        runTest {
            for ((text, contentType, expected) in listOf(
                Triple(
                    """{"title":"Invalid","status":403,"code":"auth.integrity_invalid"}""",
                    "application/json",
                    true,
                ),
                Triple("<html>Error</html>", "text/html", false),
                Triple("""{"message":"Error"}""", "application/json", false),
            )) {
                testClient(
                    MockEngine {
                        respond(
                            text,
                            if (expected) HttpStatusCode.Forbidden else HttpStatusCode.BadGateway,
                            headersOf(HttpHeaders.ContentType, contentType),
                        )
                    },
                ).use { client ->
                    val result = KtorAuthApi(client).requestOtp(body)
                    if (expected) {
                        assertInstanceOf(ApiResult.Failure.Problem::class.java, result)
                    } else {
                        assertEquals(ApiResult.Failure.Unexpected(502), result)
                    }
                }
            }
        }

    @Test
    fun `transport failures are values and cancellation propagates`() =
        runTest {
            testClient(MockEngine { throw IOException("offline") }).use { client ->
                assertInstanceOf(ApiResult.Failure.Network::class.java, KtorAuthApi(client).requestOtp(body))
            }
            testClient(MockEngine { throw CancellationException("cancelled") }).use { client ->
                assertThrows<CancellationException> { KtorAuthApi(client).requestOtp(body) }
            }
        }

    @Test
    fun `map preserves failures and transforms successes`() {
        assertEquals(ApiResult.Success(6, 201), ApiResult.Success(3, 201).map { it * 2 })
        val failure = ApiResult.Failure.Unexpected(502)
        assertEquals(failure, failure.map { 1 })
        assertNull(failure.getOrNull())
        assertNull(failure.problemCode)
    }
}
