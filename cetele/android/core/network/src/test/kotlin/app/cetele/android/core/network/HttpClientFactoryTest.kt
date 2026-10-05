package app.cetele.android.core.network

import io.ktor.client.call.body
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.get
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
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
            val client = createHttpClient(ApiConfig("http://10.0.2.2:60080"), engine)

            val response = client.get("v1/me")
            val problem = response.body<ProblemDetail>()

            assertEquals("http://10.0.2.2:60080/v1/me", requestedUrl)
            assertEquals(401, problem.status)
            assertEquals("auth.required", problem.code)
            assertEquals("t1", problem.traceId)
        }
}
