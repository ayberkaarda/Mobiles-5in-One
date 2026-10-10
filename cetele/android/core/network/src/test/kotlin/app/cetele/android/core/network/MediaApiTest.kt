package app.cetele.android.core.network

import app.cetele.android.core.network.api.KtorMediaApi
import app.cetele.android.core.network.dto.media.MediaUploadView
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.content.OutgoingContent
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import java.time.Instant

class MediaApiTest {
    @Test
    fun `storage upload keeps signed headers without bearer or API defaults`() =
        runTest {
            val bytes = byteArrayOf(1, 2, 3)
            val signed = mapOf("Content-Type" to "image/jpeg", "Content-Length" to "3", "x-storage-check" to "value")
            val view =
                MediaUploadView("m1", "https://storage.example/photo", "PUT", signed, Instant.EPOCH, "media/s1/m1.jpg")
            HttpClientFactory
                .createStorageClient(
                    MockEngine { request ->
                        assertEquals(HttpMethod.Put, request.method)
                        assertEquals(view.uploadUrl, request.url.toString())
                        val body = request.body as OutgoingContent.ByteArrayContent
                        assertEquals("value", request.headers["x-storage-check"])
                        assertEquals("image/jpeg", body.contentType.toString())
                        assertEquals(3L, body.contentLength)
                        assertNull(request.headers[HttpHeaders.Authorization])
                        assertNull(request.headers[HttpHeaders.UserAgent])
                        assertArrayEquals(bytes, body.bytes())
                        respond("")
                    },
                ).use { storage ->
                    testClient(MockEngine { error("API client must not handle uploads") }).use { client ->
                        assertEquals(ApiResult.Success(Unit, 200), KtorMediaApi(client, storage).upload(view, bytes))
                    }
                }
        }

    @Test
    fun `download refuses bodies above the photo limit`() =
        runTest {
            HttpClientFactory.createStorageClient(MockEngine { respond(ByteArray(1_200_001)) }).use { storage ->
                testClient(MockEngine { error("API client must not fetch storage URLs") }).use { client ->
                    assertEquals(
                        ApiResult.Failure.Unexpected(413),
                        KtorMediaApi(client, storage).fetch("https://storage.example/photo"),
                    )
                }
            }
        }

    @Test
    fun `download returns bytes within the limit`() =
        runTest {
            val bytes = byteArrayOf(1, 2)
            HttpClientFactory.createStorageClient(MockEngine { respond(bytes) }).use { storage ->
                testClient(MockEngine { error("API client must not fetch storage URLs") }).use { client ->
                    assertArrayEquals(
                        bytes,
                        KtorMediaApi(client, storage).fetch("https://storage.example/photo").getOrNull(),
                    )
                }
            }
        }
}
