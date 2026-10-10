package app.cetele.server.billing

import app.cetele.server.billing.play.PlaySubscriptionPurchase
import app.cetele.server.billing.play.PlaySubscriptionResult
import app.cetele.server.support.IntegrationTest
import app.cetele.server.tenancy.TenancyFixtures.Companion.expectProblem
import com.jayway.jsonpath.JsonPath
import org.junit.jupiter.api.Test
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import java.time.Duration
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

@IntegrationTest
class BillingLinkTest : BillingTestSupport() {
    @Test
    fun `owner links an active purchase and the shop becomes pro`() {
        val world = world()
        assertEquals("FREE", JsonPath.read(billing(world.shopId, world.owner).andReturn().response.contentAsString, "$.plan"))
        val token = token("active", world.shopId)
        val body = linkOk(world.shopId, token, world.owner)

        assertEquals("PRO", JsonPath.read(body, "$.plan"))
        assertNull(JsonPath.read<Any?>(body, "$.limits.customers"))
        assertEquals(2000, JsonPath.read<Int>(body, "$.limits.photosPerMonth"))
        assertEquals(500, JsonPath.read<Int>(body, "$.limits.smsPerMonth"))
        assertEquals("cetele_pro", JsonPath.read(body, "$.subscription.productId"))
        assertEquals("monthly", JsonPath.read(body, "$.subscription.basePlanId"))
        assertEquals("ACTIVE", JsonPath.read(body, "$.subscription.state"))
        assertTrue(JsonPath.read(body, "$.subscription.entitled"))
        assertTrue(JsonPath.read(body, "$.subscription.autoRenewing"))
        assertTrue(JsonPath.read(body, "$.subscription.testPurchase"))
        assertNotNull(JsonPath.read<String>(body, "$.subscription.expiresAt"))
        assertNotNull(JsonPath.read<String>(body, "$.subscription.linkedAt"))
        assertFalse(body.contains(token))
        assertFalse(body.contains(PurchaseTokens.hash(token)))
        assertEquals("PRO", plan(world.shopId))

        // The server acknowledges after binding; the token is stored only hashed and encrypted.
        assertTrue(token in fake.acknowledgements())
        val row = row(token)
        assertNotNull(row["acknowledged_at"])
        assertEquals(world.owner.id, row["linked_by"])
        val stored = row["purchase_token_enc"] as ByteArray
        assertEquals(PurchaseTokenCipher.VERSION, stored[0])
        assertFalse(String(stored, Charsets.ISO_8859_1).contains(token))

        val staffView = billing(world.shopId, world.staff).andReturn().response
        assertEquals(200, staffView.status)
        assertEquals("PRO", JsonPath.read(staffView.contentAsString, "$.plan"))
        assertEquals(
            "PRO",
            JsonPath.read(
                mvc
                    .get("/v1/shops/${world.shopId}") { header("Authorization", world.owner.bearer) }
                    .andReturn()
                    .response.contentAsString,
                "$.plan",
            ),
        )
    }

    @Test
    fun `staff gets forbidden and a stranger not found`() {
        val world = world()
        val stranger = tenancy().actor()
        link(world.shopId, token("active", world.shopId), world.staff).expectProblem(403, "forbidden")
        link(world.shopId, token("active", world.shopId), stranger).expectProblem(404, "not_found")
        billing(world.shopId, stranger).expectProblem(404, "not_found")
        assertEquals(0, rows(world.shopId))
        assertEquals("FREE", plan(world.shopId))

        // Another shop's owner cannot read or link this shop either.
        val other = world()
        billing(world.shopId, other.owner).expectProblem(404, "not_found")
        link(world.shopId, token("active", world.shopId), other.owner).expectProblem(404, "not_found")
        mvc.get("/v1/shops/${world.shopId}/billing").andExpect { status { isUnauthorized() } }
    }

    @Test
    fun `repeat link is idempotent`() {
        val world = world()
        val token = token("active", world.shopId)
        linkOk(world.shopId, token, world.owner)
        val id = row(token)["id"]
        val again = linkOk(world.shopId, token, world.owner)
        assertEquals("ACTIVE", JsonPath.read(again, "$.subscription.state"))
        assertEquals(1, rows(world.shopId))
        assertEquals(id, row(token)["id"])
        assertEquals(1, fake.acknowledgements().count { it == token })
        assertEquals("PRO", plan(world.shopId))
    }

    @Test
    fun `token of another shop is refused before play is called`() {
        val first = world()
        val second = world()
        val token = token("active", first.shopId)
        linkOk(first.shopId, token, first.owner)
        // Were Play asked, this answer would be 503; the hash lookup refuses first.
        fake.put(token, PlaySubscriptionResult.Unavailable("fake"))
        link(second.shopId, token, second.owner).expectProblem(409, "billing.token_in_use")
        assertEquals(0, rows(second.shopId))
        assertEquals("FREE", plan(second.shopId))
        assertEquals(first.shopId, row(token)["shop_id"])
    }

    @Test
    fun `purchase made for another shop is token in use`() {
        val first = world()
        val second = world()
        val token = token("active", first.shopId)
        link(second.shopId, token, second.owner).expectProblem(409, "billing.token_in_use")
        assertEquals(0, rows(second.shopId))
        assertEquals("FREE", plan(second.shopId))
        assertEquals(
            0,
            jdbc.queryForObject(
                "SELECT count(*) FROM subscriptions WHERE purchase_token_hash = ?",
                Int::class.java,
                PurchaseTokens.hash(token),
            ),
        )
    }

    @Test
    fun `unknown token is purchase invalid`() {
        val world = world()
        listOf("unknown", "expired", "otherproduct", "nonsense").forEach { state ->
            link(world.shopId, token(state, world.shopId), world.owner).expectProblem(422, "billing.purchase_invalid")
        }
        val noAccount = token("active", world.shopId)
        fake.put(noAccount, fake.purchase(PlaySubscriptionPurchase.STATE_ACTIVE, world.shopId).copy(obfuscatedExternalAccountId = null))
        link(world.shopId, noAccount, world.owner).expectProblem(422, "billing.purchase_invalid")
        val unspecified = token("active", world.shopId)
        fake.put(unspecified, fake.purchase(PlaySubscriptionPurchase.STATE_UNSPECIFIED, world.shopId))
        link(world.shopId, unspecified, world.owner).expectProblem(422, "billing.purchase_invalid")
        assertEquals(0, rows(world.shopId))
        assertEquals("FREE", plan(world.shopId))
    }

    @Test
    fun `play unavailable answers 503 with retry after`() {
        val world = world()
        val response = link(world.shopId, token("unavailable", world.shopId), world.owner)
        response.expectProblem(503, "billing.unavailable")
        assertEquals("30", response.andReturn().response.getHeader("Retry-After"))
        assertEquals(0, rows(world.shopId))
    }

    @Test
    fun `pending purchase stays free`() {
        val world = world()
        val token = token("pending", world.shopId)
        val body = linkOk(world.shopId, token, world.owner)
        assertEquals("FREE", JsonPath.read(body, "$.plan"))
        assertEquals(100, JsonPath.read<Int>(body, "$.limits.customers"))
        assertEquals("PENDING", JsonPath.read(body, "$.subscription.state"))
        assertFalse(JsonPath.read(body, "$.subscription.entitled"))
        assertNull(JsonPath.read<Any?>(body, "$.subscription.expiresAt"))
        assertFalse(token in fake.acknowledgements())
        assertEquals("FREE", plan(world.shopId))

        // The update to PURCHASED arrives; linking again verifies it and grants PRO.
        fake.put(token, fake.purchase(PlaySubscriptionPurchase.STATE_ACTIVE, world.shopId))
        assertEquals("PRO", JsonPath.read(linkOk(world.shopId, token, world.owner), "$.plan"))
        assertTrue(token in fake.acknowledgements())
    }

    @Test
    fun `replacement through linked purchase token supersedes the current row`() {
        val world = world()
        val monthly = token("active", world.shopId)
        linkOk(world.shopId, monthly, world.owner)
        val yearly = token("active", world.shopId)
        fake.put(
            yearly,
            fake.purchase(PlaySubscriptionPurchase.STATE_ACTIVE, world.shopId, Duration.ofDays(365), linkedPurchaseToken = monthly),
        )
        val body = linkOk(world.shopId, yearly, world.owner)
        assertEquals("PRO", JsonPath.read(body, "$.plan"))
        assertEquals("ACTIVE", JsonPath.read(body, "$.subscription.state"))
        val old = row(monthly)
        val new = row(yearly)
        assertEquals("REPLACED", old["state"])
        assertNotNull(old["superseded_at"])
        assertEquals(new["id"], old["replaced_by"])
        assertNull(new["superseded_at"])
        assertEquals(
            1,
            jdbc.queryForObject(
                "SELECT count(*) FROM subscriptions WHERE shop_id = ? AND superseded_at IS NULL",
                Int::class.java,
                world.shopId,
            ),
        )
        assertEquals("PRO", plan(world.shopId))

        // The replaced token never entitles again and stays bound to this shop.
        val other = world()
        link(other.shopId, monthly, other.owner).expectProblem(409, "billing.token_in_use")
    }

    @Test
    fun `second subscription while entitled is already subscribed`() {
        val world = world()
        linkOk(world.shopId, token("active", world.shopId), world.owner)
        val second = token("active", world.shopId)
        link(world.shopId, second, world.owner).expectProblem(409, "billing.already_subscribed")
        assertEquals(1, rows(world.shopId))
        assertFalse(second in fake.acknowledgements())
    }

    @Test
    fun `a current row that no longer entitles is superseded by a new purchase`() {
        val world = world()
        val held = token("hold", world.shopId)
        linkOk(world.shopId, held, world.owner)
        assertEquals("FREE", plan(world.shopId))
        val fresh = token("active", world.shopId)
        assertEquals("PRO", JsonPath.read(linkOk(world.shopId, fresh, world.owner), "$.plan"))
        assertEquals("ON_HOLD", state(held))
        assertNotNull(row(held)["superseded_at"])
        assertNull(row(held)["replaced_by"])
        assertEquals(2, rows(world.shopId))
    }

    @Test
    fun `malformed bodies and another product are validation failures`() {
        val world = world()
        val token = token("active", world.shopId)
        assertField(
            link(world.shopId, token, world.owner, productId = "cetele_other").expectProblem(422, "validation.failed"),
            "productId",
            "out_of_range",
        )
        assertField(
            link(world.shopId, "bad token!", world.owner).expectProblem(422, "validation.failed"),
            "purchaseToken",
            "invalid_format",
        )
        assertField(
            link(world.shopId, token, world.owner, productId = "Cetele").expectProblem(422, "validation.failed"),
            "productId",
            "invalid_format",
        )
        val unknown =
            mvc
                .post("/v1/shops/${world.shopId}/billing/link") {
                    header("Authorization", world.owner.bearer)
                    contentType = MediaType.APPLICATION_JSON
                    content = """{"productId":"cetele_pro","purchaseToken":"$token","plan":"PRO"}"""
                }.expectProblem(422, "validation.failed")
        assertField(unknown, "plan", "unknown_property")
        assertEquals(0, rows(world.shopId))
    }

    @Test
    fun `link calls are rate limited per user`() {
        val world = world()
        repeat(10) { link(world.shopId, token("unknown", world.shopId), world.owner).expectProblem(422, "billing.purchase_invalid") }
        val limited = link(world.shopId, token("active", world.shopId), world.owner)
        limited.expectProblem(429, "rate_limited")
        assertTrue(
            limited
                .andReturn()
                .response
                .getHeader("Retry-After")!!
                .toLong() > 0,
        )
        assertEquals(0, rows(world.shopId))
    }

    @Test
    fun `a stored token is never moved to a shop created later by the same owner`() {
        val world = world()
        val token = token("active", world.shopId)
        linkOk(world.shopId, token, world.owner)
        val second = tenancy().shop(world.owner)
        link(second, token, world.owner).expectProblem(409, "billing.token_in_use")
        assertEquals(world.shopId, row(token)["shop_id"])
    }

    private fun assertField(
        body: String,
        field: String,
        code: String,
    ) {
        val errors = JsonPath.read<List<Map<String, String>>>(body, "$.errors")
        assertTrue(errors.any { it["field"] == field && it["code"] == code }, errors.toString())
    }
}
