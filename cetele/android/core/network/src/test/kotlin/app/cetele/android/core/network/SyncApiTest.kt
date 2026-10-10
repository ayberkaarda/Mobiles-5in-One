package app.cetele.android.core.network

import app.cetele.android.core.network.api.KtorSyncApi
import app.cetele.android.core.network.dto.SyncKind
import app.cetele.android.core.network.dto.sync.PushRequest
import app.cetele.android.core.network.dto.sync.SyncOperation
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpMethod
import io.ktor.http.content.TextContent
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SyncApiTest {
    @Test
    fun `push uses captured operation fields and pull uses cursor parameters`() =
        runTest {
            val payload = PushRequest(listOf(SyncOperation("op1", 7, SyncKind.CUSTOMER_DELETE, customerId = "c1")))
            testClient(
                MockEngine { request ->
                    if (request.method == HttpMethod.Post) {
                        assertEquals("/v1/shops/shop1/sync/push", request.url.encodedPath)
                        assertEquals(
                            payload,
                            NetworkJson.decodeFromString<PushRequest>((request.body as TextContent).text),
                        )
                        respond(
                            """{"results":[{"clientId":"op1","status":"APPLIED","entityId":"c1"}],"head":9}""",
                            headers = jsonHeaders,
                        )
                    } else {
                        assertEquals("/v1/shops/shop1/sync/pull", request.url.encodedPath)
                        assertEquals("9", request.url.parameters["since"])
                        assertEquals("2", request.url.parameters["limit"])
                        respond("""{"changes":[],"nextSince":9,"hasMore":false}""", headers = jsonHeaders)
                    }
                },
            ).use { client ->
                val api = KtorSyncApi(client)
                assertEquals(9L, api.push("shop1", payload).getOrNull()?.head)
                assertTrue(
                    api
                        .pull("shop1", 9, 2)
                        .getOrNull()
                        ?.changes
                        ?.isEmpty() == true,
                )
            }
        }
}
