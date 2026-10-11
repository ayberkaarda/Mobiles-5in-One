package app.cetele.android.core.network

import app.cetele.android.core.network.api.DeviceSession
import app.cetele.android.core.network.api.DeviceSignOutBody
import app.cetele.android.core.network.api.KtorAuthApi
import app.cetele.android.core.network.api.KtorDevicesApi
import app.cetele.android.core.network.api.ReauthAction
import app.cetele.android.core.network.api.ReauthRequest
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class SecurityApiTest {
    @Test fun everyReauthActionPostsItsExactScope() =
        runTest {
            for (action in ReauthAction.entries) {
                val shopAction = action == ReauthAction.SHOP_DELETE || action == ReauthAction.OWNERSHIP_TRANSFER
                val shopId = if (shopAction) "shop-a" else null
                val engine =
                    MockEngine { request ->
                        assertEquals(HttpMethod.Post, request.method)
                        assertEquals("/v1/auth/reauth/request", request.url.encodedPath)
                        val expected = mutableMapOf("action" to JsonPrimitive(action.name))
                        if (shopId != null) expected["shopId"] = JsonPrimitive(shopId)
                        val body = (request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString()
                        assertEquals(JsonObject(expected), NetworkJson.parseToJsonElement(body))
                        respond("", HttpStatusCode.Accepted)
                    }
                testClient(engine).use { client ->
                    assertEquals(ApiResult.Success(Unit, 202), KtorAuthApi(client).requestReauth(action, shopId))
                }
            }
        }

    @Test fun invalidScopesAreRejected() {
        assertThrows(IllegalArgumentException::class.java) { ReauthRequest(ReauthAction.SHOP_DELETE) }
        assertThrows(IllegalArgumentException::class.java) { ReauthRequest(ReauthAction.OWNERSHIP_TRANSFER, " ") }
        assertThrows(IllegalArgumentException::class.java) { ReauthRequest(ReauthAction.ACCOUNT_DELETE, "shop-a") }
        assertThrows(IllegalArgumentException::class.java) { ReauthRequest(ReauthAction.DEVICE_SIGN_OUT, "shop-a") }
    }

    @Test fun deviceListReadsArrayAndSignOutPostsOnlyCodeToRowId() =
        runTest {
            val device = DeviceSession("row-id", "Phone", "1.0", "2026-10-11T12:00:00Z", true, true)
            val engine =
                MockEngine { request ->
                    if (request.method == HttpMethod.Get) {
                        assertEquals("/v1/me/devices", request.url.encodedPath)
                        respond(NetworkJson.encodeToString(listOf(device)), HttpStatusCode.OK, jsonHeaders)
                    } else {
                        assertEquals(HttpMethod.Post, request.method)
                        assertEquals("/v1/me/devices/row-id/sign-out", request.url.encodedPath)
                        val body = (request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString()
                        assertEquals(
                            JsonObject(mapOf("code" to JsonPrimitive("123456"))),
                            NetworkJson.parseToJsonElement(body),
                        )
                        respond("", HttpStatusCode.NoContent)
                    }
                }
            testClient(engine).use { client ->
                val api = KtorDevicesApi(client)
                assertEquals(ApiResult.Success(listOf(device), 200), api.list())
                assertEquals(ApiResult.Success(Unit, 204), api.signOut(device.id, DeviceSignOutBody("123456")))
            }
            assertFalse(DeviceSignOutBody("123456").toString().contains("123456"))
        }

    @Test fun deviceSignOutFailurePreservesProblemCode() =
        runTest {
            for (code in listOf("auth.reauth_invalid", "not_found")) {
                val status = if (code == "not_found") HttpStatusCode.NotFound else HttpStatusCode.Forbidden
                val engine =
                    MockEngine {
                        respond("""{"title":"Rejected","status":${status.value},"code":"$code"}""", status, jsonHeaders)
                    }
                testClient(engine).use { client ->
                    val result = KtorDevicesApi(client).signOut("row-id", DeviceSignOutBody("123456"))
                    assertEquals(code, result.problemCode)
                }
            }
        }
}
