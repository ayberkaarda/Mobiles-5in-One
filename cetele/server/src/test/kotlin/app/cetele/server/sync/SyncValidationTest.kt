package app.cetele.server.sync

import app.cetele.server.support.IntegrationTest
import com.jayway.jsonpath.JsonPath
import org.junit.jupiter.api.Test
import org.springframework.http.HttpHeaders.AUTHORIZATION
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@IntegrationTest
class SyncValidationTest : SyncTestSupport() {
    @Test
    fun `batch size ordering duplicate ids and malformed shapes reject the entire batch`() {
        val world = world()
        val duplicate = customer(1)
        val bodies =
            listOf(
                PushRequest((1L..501L).map { customer(it) }),
                PushRequest(listOf(customer(2), customer(1))),
                PushRequest(listOf(duplicate, duplicate.copy(clientSeq = 2))),
                PushRequest(listOf(customer(1).copy(customer = null))),
                PushRequest(listOf(customer(0))),
                PushRequest(listOf(customer(1).copy(customerId = id()))),
            )
        bodies.forEach { request ->
            val response =
                mvc
                    .post("/v1/shops/${world.shopId}/sync/push") {
                        header(AUTHORIZATION, world.owner.bearer)
                        contentType = MediaType.APPLICATION_JSON
                        content = mapper.writeValueAsString(request)
                    }.andReturn()
                    .response
            assertEquals(422, response.status, response.contentAsString)
            assertEquals("validation.failed", JsonPath.read(response.contentAsString, "$.code"))
            assertTrue(JsonPath.read<List<Any>>(response.contentAsString, "$.errors").isNotEmpty())
            assertEquals(0L, ledger().head(world.shopId))
        }
    }

    @Test
    fun `invalid fields are rejected individually while valid neighbours apply`() {
        val world = world()
        val c = ledger().customer(world.shopId)
        val badPhone = customer(7).let { it.copy(customer = it.customer!!.copy(phone = "+44" + "7".repeat(10))) }
        val badConsent = customer(8).let { it.copy(customer = it.customer!!.copy(smsConsent = true)) }
        val requests =
            listOf(
                entry(1, c, 0),
                entry(2, c, 10_000_000_001),
                entry(3, c).let { it.copy(entry = it.entry!!.copy(photoKey = "media/${id()}/${id()}.jpg")) },
                entry(4, c, type = "PAYMENT").let { it.copy(entry = it.entry!!.copy(dueOn = it.entry.occurredOn)) },
                entry(5, c).let { it.copy(entry = it.entry!!.copy(note = "x".repeat(501))) },
                entry(6, c).let { it.copy(entry = it.entry!!.copy(occurredOn = it.entry.occurredOn.plusDays(2))) },
                badPhone,
                badConsent,
                customer(9).let { it.copy(customer = it.customer!!.copy(name = "x".repeat(81), tag = "")) },
                entry(10, c).let { it.copy(entry = it.entry!!.copy(type = "OTHER")) },
                entry(11, c),
            )
        val result = push(world, requests)
        assertEquals(List(10) { "validation.failed" } + listOf(null), result.results.map { it.code })
        assertTrue(result.results.take(10).all { it.status == OperationStatus.REJECTED && !it.errors.isNullOrEmpty() })
        assertEquals(OperationStatus.APPLIED, result.results.last().status)
        assertEquals(1L, result.head)
        val fieldCodes = result.results.take(10).map { row -> row.errors!!.map { it.field to it.code } }
        assertEquals(listOf("entry.amountMinor" to "out_of_range"), fieldCodes[0])
        assertEquals(listOf("entry.amountMinor" to "out_of_range"), fieldCodes[1])
        assertEquals(listOf("entry.photoKey" to "invalid_format"), fieldCodes[2])
        assertEquals(listOf("entry.dueOn" to "invalid_format"), fieldCodes[3])
        assertEquals(listOf("entry.note" to "too_long"), fieldCodes[4])
        assertEquals(listOf("entry.occurredOn" to "out_of_range"), fieldCodes[5])
        assertEquals(listOf("customer.phone" to "invalid_format"), fieldCodes[6])
        assertEquals(listOf("customer.smsConsentAt" to "required", "customer.smsConsentSource" to "required"), fieldCodes[7])
        assertEquals(listOf("customer.name" to "too_long", "customer.tag" to "required"), fieldCodes[8])
        assertEquals(listOf("entry.type" to "invalid_format"), fieldCodes[9])
    }

    @Test
    fun `unknown operation properties and kinds reject before applying`() {
        val world = world()
        val op = mapper.writeValueAsString(customer(1))
        val bodies = listOf(op.dropLast(1) + ",\"extra\":true}", op.replace("CUSTOMER_UPSERT", "OTHER"))
        bodies.forEach { body ->
            val response =
                mvc
                    .post("/v1/shops/${world.shopId}/sync/push") {
                        header(AUTHORIZATION, world.owner.bearer)
                        contentType = MediaType.APPLICATION_JSON
                        content = "{\"operations\":[$body]}"
                    }.andReturn()
                    .response
            assertEquals(422, response.status, response.contentAsString)
        }
        assertEquals(0L, ledger().head(world.shopId))
    }

    @Test
    fun `pull parameters are bounded`() {
        val world = world()
        listOf("since=-1", "limit=0", "limit=501").forEach { query ->
            val response =
                mvc
                    .get("/v1/shops/${world.shopId}/sync/pull?$query") {
                        header(AUTHORIZATION, world.owner.bearer)
                    }.andReturn()
                    .response
            assertEquals(422, response.status)
        }
    }
}
