package app.cetele.server.sync

import app.cetele.server.config.CeteleTime
import app.cetele.server.ledger.LedgerFixtures
import app.cetele.server.security.TraceIdFilter
import app.cetele.server.support.TestAuth
import app.cetele.server.tenancy.ShopWorld
import app.cetele.server.tenancy.TenancyFixtures
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpHeaders.AUTHORIZATION
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import tools.jackson.databind.ObjectMapper
import java.time.Clock
import java.util.UUID
import kotlin.test.assertEquals

abstract class SyncTestSupport {
    @Autowired lateinit var mvc: MockMvc

    @Autowired lateinit var auth: TestAuth

    @Autowired lateinit var jdbc: JdbcTemplate

    @Autowired lateinit var mapper: ObjectMapper

    @Autowired lateinit var clock: Clock

    fun world(): ShopWorld = TenancyFixtures(mvc, auth, jdbc).world()

    fun ledger() = LedgerFixtures(jdbc, clock)

    fun id(): UUID = TraceIdFilter.uuidV7()

    fun customer(
        seq: Long,
        id: UUID = id(),
        name: String = "Customer",
    ) = SyncOperation(id(), seq, OperationKind.CUSTOMER_UPSERT, customer = CustomerInput(id, name, smsConsent = false))

    fun entry(
        seq: Long,
        customerId: UUID,
        amount: Long = 12_500L,
        type: String = "DEBT",
        reverses: UUID? = null,
    ) = SyncOperation(
        id(),
        seq,
        OperationKind.ENTRY_CREATE,
        entry = EntryInput(id(), customerId, type, amount, CeteleTime.today(clock), reverses = reverses),
    )

    fun delete(
        seq: Long,
        customerId: UUID,
    ) = SyncOperation(id(), seq, OperationKind.CUSTOMER_DELETE, customerId = customerId)

    fun push(
        world: ShopWorld,
        operations: List<SyncOperation>,
        bearer: String = world.owner.bearer,
    ): PushResponse {
        val response =
            mvc
                .post("/v1/shops/${world.shopId}/sync/push") {
                    header(AUTHORIZATION, bearer)
                    contentType = MediaType.APPLICATION_JSON
                    content = mapper.writeValueAsString(PushRequest(operations))
                }.andReturn()
                .response
        assertEquals(200, response.status, response.contentAsString)
        return mapper.readValue(response.contentAsString, PushResponse::class.java)
    }

    fun pull(
        world: ShopWorld,
        bearer: String = world.owner.bearer,
        since: Long = 0,
        limit: Int = 500,
    ): String {
        val response =
            mvc
                .get("/v1/shops/${world.shopId}/sync/pull?since=$since&limit=$limit") {
                    header(AUTHORIZATION, bearer)
                }.andReturn()
                .response
        assertEquals(200, response.status, response.contentAsString)
        return response.contentAsString
    }

    fun assertCodes(
        result: PushResponse,
        vararg codes: String?,
    ) {
        assertEquals(codes.toList(), result.results.map { it.code })
        result.results.zip(codes.toList()).forEach { (row, code) ->
            assertEquals(if (code == null) OperationStatus.APPLIED else OperationStatus.REJECTED, row.status)
        }
    }
}
