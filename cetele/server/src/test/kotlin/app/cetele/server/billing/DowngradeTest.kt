package app.cetele.server.billing

import app.cetele.server.billing.play.FakePlayDeveloperApi
import app.cetele.server.billing.play.PlayDeveloperApi
import app.cetele.server.billing.play.PlaySubscriptionPurchase
import app.cetele.server.security.TraceIdFilter
import app.cetele.server.support.IntegrationTest
import app.cetele.server.sync.SyncTestSupport
import app.cetele.server.tenancy.ShopWorld
import app.cetele.server.tenancy.TenancyFixtures.Companion.expectProblem
import com.jayway.jsonpath.JsonPath
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpHeaders.AUTHORIZATION
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import java.time.Duration
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** ADR-0031 "What a downgrade does to existing data": nothing is deleted or hidden, only new creation is limited. */
@IntegrationTest
class DowngradeTest : SyncTestSupport() {
    @Autowired lateinit var playApi: PlayDeveloperApi

    @Autowired lateinit var writer: SubscriptionWriter

    @Autowired lateinit var index: SubscriptionIndex

    private val fake get() = playApi as FakePlayDeveloperApi

    /** Makes [world]'s shop PRO through a linked purchase and returns its token. */
    private fun upgrade(world: ShopWorld): String {
        val token =
            FakePlayDeveloperApi.token(
                "active",
                world.shopId,
                UUID
                    .randomUUID()
                    .toString()
                    .take(8)
                    .replace("-", "a"),
            )
        val response =
            mvc
                .post("/v1/shops/${world.shopId}/billing/link") {
                    header(AUTHORIZATION, world.owner.bearer)
                    contentType = MediaType.APPLICATION_JSON
                    content = """{"productId":"cetele_pro","purchaseToken":"$token"}"""
                }.andReturn()
                .response
        assertEquals(200, response.status, response.contentAsString)
        assertEquals("PRO", plan(world))
        return token
    }

    /** Play puts the subscription on hold and the next verification applies it. */
    private fun downgrade(
        world: ShopWorld,
        token: String,
    ) {
        val purchase = fake.purchase(PlaySubscriptionPurchase.STATE_ON_HOLD, world.shopId, Duration.ofDays(-1))
        fake.put(token, purchase)
        val ref = checkNotNull(index.byTokenHash(PurchaseTokens.hash(token)))
        writer.refresh(SubscriptionKey(world.shopId, ref.id), purchase, clock.instant(), PlanChangeReason.RTDN)
        assertEquals("FREE", plan(world))
    }

    private fun plan(world: ShopWorld): String =
        jdbc.queryForObject("SELECT plan FROM shops WHERE id = ?", String::class.java, world.shopId)!!

    private fun usage(
        world: ShopWorld,
        path: String,
    ): Int =
        JsonPath.read(
            mvc
                .get("/v1/shops/${world.shopId}/billing") { header(AUTHORIZATION, world.owner.bearer) }
                .andReturn()
                .response.contentAsString,
            path,
        )

    @Test
    fun `over limit customers stay readable and writable but no new customer`() {
        val world = world()
        val token = upgrade(world)
        val existing = (1..101).map { ledger().customer(world.shopId) }
        assertCodes(push(world, listOf(customer(1))), null)
        assertEquals(102, usage(world, "$.usage.customers"))
        downgrade(world, token)

        assertEquals(100, usage(world, "$.limits.customers"))
        assertEquals(102, usage(world, "$.usage.customers"))
        // Existing customers are updated and receive entries; a new one is refused per operation.
        assertCodes(
            push(world, listOf(customer(2, existing.first(), "Renamed"), entry(3, existing[1]), customer(4)), bearer = world.staff.bearer),
            null,
            null,
            "plan.customer_limit",
        )
        val pulled = pull(world)
        assertTrue(pulled.contains("Renamed"))
        assertEquals(
            102,
            jdbc.queryForObject("SELECT count(*) FROM customers WHERE shop_id = ? AND deleted_at IS NULL", Int::class.java, world.shopId),
        )
        // Deleting stays allowed; below the limit a new customer fits again.
        assertCodes(push(world, (0 until 3).map { delete(5L + it, existing[10 + it]) }), null, null, null)
        assertCodes(push(world, listOf(customer(8))), null)
    }

    @Test
    fun `photo and sms limits drop at once`() {
        val world = world()
        val token = upgrade(world)
        repeat(200) {
            val id = TraceIdFilter.uuidV7()
            jdbc.update(
                "INSERT INTO media_objects (id, shop_id, status, declared_content_type, declared_length, upload_key, photo_key, " +
                    "upload_expires_at, ready_at) VALUES (?, ?, 'READY', 'image/jpeg', 3, ?, ?, now(), now())",
                id,
                world.shopId,
                "uploads/${world.shopId}/$id",
                "media/${world.shopId}/$id.jpg",
            )
        }
        jdbc.update(
            "INSERT INTO sms_quota (shop_id, month, used) VALUES (?, date_trunc('month', now() AT TIME ZONE 'Europe/Istanbul')::date, 31)",
            world.shopId,
        )
        val customer = ledger().customer(world.shopId, smsConsent = true).also { ledger().entry(world.shopId, it) }
        presign(world).andExpect { status { isCreated() } }
        assertEquals(201, usage(world, "$.usage.photos"))
        assertEquals(31, usage(world, "$.usage.sms"))

        downgrade(world, token)
        presign(world).expectProblem(409, "plan.photo_limit")
        val reminder =
            mvc.post("/v1/shops/${world.shopId}/reminders") {
                header(AUTHORIZATION, world.owner.bearer)
                contentType = MediaType.APPLICATION_JSON
                content = """{"customerId":"$customer","channel":"SMS","template":"BALANCE"}"""
            }
        reminder.expectProblem(429, "sms.quota_exceeded")
        assertTrue(
            reminder
                .andReturn()
                .response
                .getHeader("Retry-After")!!
                .toLong() > 0,
        )
        assertEquals(200, usage(world, "$.limits.photosPerMonth"))
        assertEquals(30, usage(world, "$.limits.smsPerMonth"))
        // Nothing was deleted or hidden.
        assertEquals(201, usage(world, "$.usage.photos"))
        assertEquals(31, usage(world, "$.usage.sms"))
    }

    private fun presign(world: ShopWorld) =
        mvc.post("/v1/shops/${world.shopId}/media/presign") {
            header(AUTHORIZATION, world.owner.bearer)
            contentType = MediaType.APPLICATION_JSON
            content = """{"contentType":"image/jpeg","contentLength":1000}"""
        }
}
