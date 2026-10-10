package app.cetele.android.core.network

import app.cetele.android.core.network.api.KtorBillingApi
import app.cetele.android.core.network.dto.ShopPlan
import app.cetele.android.core.network.dto.billing.BillingState
import app.cetele.android.core.network.dto.billing.LinkPurchaseRequest
import app.cetele.android.core.network.dto.billing.PlanLimitsView
import app.cetele.android.core.network.dto.billing.PlanUsageView
import app.cetele.android.core.network.dto.billing.SubscriptionState
import app.cetele.android.core.network.dto.billing.SubscriptionView
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import java.time.Instant

class BillingApiTest {
    private val shopId = "01928c3e-5f6a-7b8c-9d0e-1f2a3b4c5d6e"
    private val proBody =
        """
        {
          "plan": "PRO",
          "limits": { "customers": null, "photosPerMonth": 2000, "smsPerMonth": 500 },
          "usage": { "month": "2026-10", "customers": 137, "photos": 12, "sms": 3 },
          "subscription": {
            "productId": "cetele_pro",
            "basePlanId": "monthly",
            "state": "ACTIVE",
            "entitled": true,
            "expiresAt": "2026-11-11T09:30:00Z",
            "autoRenewing": true,
            "testPurchase": false,
            "linkedAt": "2026-10-11T09:30:05Z"
          }
        }
        """.trimIndent()
    private val freeBody =
        """
        {
          "plan": "FREE",
          "limits": { "customers": 100, "photosPerMonth": 200, "smsPerMonth": 30 },
          "usage": { "month": "2026-10", "customers": 4, "photos": 0, "sms": 0 },
          "subscription": null
        }
        """.trimIndent()

    @Test
    fun `state reads the handoff body with an unlimited customer limit`() =
        runTest {
            val requests = mutableListOf<HttpRequestData>()
            val result =
                api(
                    MockEngine { request ->
                        requests += request
                        respond(proBody, HttpStatusCode.OK, jsonHeaders)
                    },
                ).state(shopId)
            assertEquals(HttpMethod.Get, requests.single().method)
            assertEquals("/v1/shops/$shopId/billing", requests.single().url.encodedPath)
            val expected =
                BillingState(
                    plan = ShopPlan.PRO,
                    limits = PlanLimitsView(customers = null, photosPerMonth = 2000, smsPerMonth = 500),
                    usage = PlanUsageView(month = "2026-10", customers = 137, photos = 12, sms = 3),
                    subscription =
                        SubscriptionView(
                            productId = "cetele_pro",
                            basePlanId = "monthly",
                            state = SubscriptionState.ACTIVE,
                            entitled = true,
                            expiresAt = Instant.parse("2026-11-11T09:30:00Z"),
                            autoRenewing = true,
                            testPurchase = false,
                            linkedAt = Instant.parse("2026-10-11T09:30:05Z"),
                        ),
                )
            assertEquals(ApiResult.Success(expected, 200), result)
        }

    @Test
    fun `state reads a free shop without subscription`() =
        runTest {
            val state = api(MockEngine { respond(freeBody, HttpStatusCode.OK, jsonHeaders) }).state(shopId).getOrNull()
            assertEquals(ShopPlan.FREE, state?.plan)
            assertEquals(100, state?.limits?.customers)
            assertEquals(null, state?.subscription)
        }

    @Test
    fun `pending subscription has no expiry and every stored state decodes`() =
        runTest {
            SubscriptionState.entries.forEach { value ->
                val body =
                    proBody
                        .replace("\"ACTIVE\"", "\"${value.name}\"")
                        .replace("\"2026-11-11T09:30:00Z\"", "null")
                val state = api(MockEngine { respond(body, HttpStatusCode.OK, jsonHeaders) }).state(shopId).getOrNull()
                assertEquals(value, state?.subscription?.state)
                assertEquals(null, state?.subscription?.expiresAt)
            }
        }

    @Test
    fun `link posts product and token to the shop path and returns the fresh state`() =
        runTest {
            val requests = mutableListOf<HttpRequestData>()
            val token = "fake.sub.active.$shopId"
            val result =
                api(
                    MockEngine { request ->
                        requests += request
                        respond(proBody, HttpStatusCode.OK, jsonHeaders)
                    },
                ).link(shopId, LinkPurchaseRequest("cetele_pro", token))
            val request = requests.single()
            assertEquals(HttpMethod.Post, request.method)
            assertEquals("/v1/shops/$shopId/billing/link", request.url.encodedPath)
            val body =
                NetworkJson.parseToJsonElement(
                    (request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString(),
                )
            assertEquals(
                JsonObject(mapOf("productId" to JsonPrimitive("cetele_pro"), "purchaseToken" to JsonPrimitive(token))),
                body.jsonObject,
            )
            assertEquals(ShopPlan.PRO, result.getOrNull()?.plan)
        }

    @Test
    fun `link request never prints the purchase token`() {
        val text = LinkPurchaseRequest("cetele_pro", "fake.sub.active.$shopId").toString()
        assertFalse(text.contains("fake.sub"))
        assertTrue(text.contains("cetele_pro"))
    }

    @ParameterizedTest
    @CsvSource(
        "403, forbidden,",
        "404, not_found,",
        "409, billing.token_in_use,",
        "409, billing.already_subscribed,",
        "422, billing.purchase_invalid,",
        "422, validation.failed,",
        "429, rate_limited, 120",
        "503, billing.unavailable, 30",
    )
    fun `link failures carry the problem code and retry after`(
        status: Int,
        code: String,
        retryAfter: Int?,
    ) = runTest {
        val headers =
            if (retryAfter == null) {
                headersOf(HttpHeaders.ContentType, "application/problem+json")
            } else {
                headersOf(
                    HttpHeaders.ContentType to listOf("application/problem+json"),
                    HttpHeaders.RetryAfter to listOf(retryAfter.toString()),
                )
            }
        val errors =
            if (code == "validation.failed") {
                ""","errors":[{"field":"productId","code":"out_of_range"}]"""
            } else {
                ""
            }
        val body = """{"title":"Rejected","status":$status,"code":"$code","traceId":"t-1"$errors}"""
        val result =
            api(MockEngine { respond(body, HttpStatusCode.fromValue(status), headers) })
                .link(shopId, LinkPurchaseRequest("cetele_pro", "fake.sub.active.$shopId"))
        val failure = result as ApiResult.Failure.Problem
        assertEquals(code, failure.problem.code)
        assertEquals(status, failure.problem.status)
        assertEquals(retryAfter, failure.retryAfterSeconds)
        if (code == "validation.failed") {
            assertEquals(
                "productId",
                failure.problem.errors
                    .single()
                    .field,
            )
            assertEquals(
                "out_of_range",
                failure.problem.errors
                    .single()
                    .code,
            )
        }
    }

    @Test
    fun `transport failure is a network failure`() =
        runTest {
            val result =
                api(MockEngine { throw java.io.IOException("Offline") })
                    .link(shopId, LinkPurchaseRequest("cetele_pro", "fake.sub.active.$shopId"))
            assertTrue(result is ApiResult.Failure.Network)
        }

    private fun api(engine: MockEngine) = KtorBillingApi(testClient(engine))
}
