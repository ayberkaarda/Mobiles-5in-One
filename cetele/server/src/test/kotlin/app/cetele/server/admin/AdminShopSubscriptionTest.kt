package app.cetele.server.admin

import app.cetele.server.billing.PurchaseTokens
import app.cetele.server.billing.play.FakePlayDeveloperApi
import app.cetele.server.support.IntegrationTest
import app.cetele.server.tenancy.TenancyFixtures
import org.junit.jupiter.api.Test
import org.springframework.http.HttpHeaders.AUTHORIZATION
import org.springframework.http.HttpHeaders.LOCATION
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import java.util.Base64
import java.util.HexFormat
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The subscription block of the shop page (handoff 002, Wave 2 item 2): product, base plan, state,
 * expiry and test flag for both console roles, audited as `SHOP_VIEWED`, and never the purchase
 * token, its hash or its ciphertext.
 */
@IntegrationTest
class AdminShopSubscriptionTest : AdminIntegrationTest() {
    @Test
    fun `both roles see the subscription state and never the token, its hash or its ciphertext`() {
        val fixtures = TenancyFixtures(mvc, auth, jdbc)
        val owner = fixtures.actor()
        val shopId = fixtures.shop(owner)
        val token =
            FakePlayDeveloperApi.token(
                "active",
                shopId,
                UUID
                    .randomUUID()
                    .toString()
                    .take(8)
                    .filter { it.isLetterOrDigit() },
            )
        val linked =
            mvc
                .post("/v1/shops/$shopId/billing/link") {
                    header(AUTHORIZATION, owner.bearer)
                    contentType = MediaType.APPLICATION_JSON
                    content = """{"productId":"cetele_pro","purchaseToken":"$token"}"""
                }.andReturn()
                .response
        assertEquals(200, linked.status, linked.contentAsString)
        val row = jdbc.queryForMap("SELECT purchase_token_hash, purchase_token_enc FROM subscriptions WHERE shop_id = ?", shopId)
        val hash = row["purchase_token_hash"] as String
        assertEquals(PurchaseTokens.hash(token), hash)
        val ciphertext = row["purchase_token_enc"] as ByteArray
        val forbidden =
            listOf(
                token,
                hash,
                Base64.getEncoder().encodeToString(ciphertext),
                Base64.getUrlEncoder().withoutPadding().encodeToString(ciphertext),
                HexFormat.of().formatHex(ciphertext),
            )

        listOf(AdminRole.ADMIN, AdminRole.SUPPORT).forEach { role ->
            val (admin, session) = admins.signedIn(role)
            val response = page("/admin/shops/$shopId", session).response
            assertEquals(200, response.status, "$role")
            val html = response.contentAsString
            assertTrue(html.contains("Abonelik"), "$role")
            assertTrue(html.contains("cetele_pro"), "$role product")
            assertTrue(html.contains("Etkin (ACTIVE)"), "$role state")
            assertTrue(html.contains("Test satın alması"), "$role test flag label")
            assertTrue(Regex("Test satın alması</dt><dd>Evet</dd>").containsMatchIn(html), "$role test flag")
            assertTrue(Regex("Bitiş</dt><dd>\\d{2}\\.\\d{2}\\.\\d{4} \\d{2}:\\d{2}</dd>").containsMatchIn(html), "$role expiry")
            forbidden.forEach { value -> assertFalse(html.contains(value), "$role page shows token material") }
            val viewed =
                admins.auditRows(admin.id).filter { it["action"] == "SHOP_VIEWED" && it["target_id"] == shopId }
            assertEquals(1, viewed.size, "$role audit")
            assertEquals("SHOP", viewed.single()["target_type"])
            assertEquals("{}", viewed.single()["metadata"])
            forbidden.forEach { value ->
                assertEquals(
                    0,
                    jdbc.queryForObject(
                        "SELECT count(*) FROM audit_logs WHERE metadata::text LIKE ?",
                        Int::class.java,
                        "%$value%",
                    ),
                )
            }
        }
        // Signed-out callers and app tokens never reach the page.
        listOf(null, owner.bearer).forEach { bearer ->
            val refused =
                mvc
                    .get("/admin/shops/$shopId") { bearer?.let { header(AUTHORIZATION, it) } }
                    .andReturn()
                    .response
            assertEquals(302, refused.status)
            assertEquals("/admin/login", refused.redirectedUrl ?: refused.getHeader(LOCATION))
            assertFalse(refused.contentAsString.contains("cetele_pro"))
        }
    }

    @Test
    fun `a shop without a current subscription says so, and a superseded row is not shown`() {
        val fixtures = TenancyFixtures(mvc, auth, jdbc)
        val owner = fixtures.actor()
        val shopId = fixtures.shop(owner)
        val replaced = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO subscriptions (id, shop_id, purchase_token_hash, product_id, base_plan_id, state, expires_at, linked_at, " +
                "last_verified_at, superseded_at) VALUES (?, ?, ?, 'cetele_pro_old', 'monthly', 'REPLACED', now(), now(), now(), now())",
            replaced,
            shopId,
            PurchaseTokens.hash("fake.sub.active.$shopId.$replaced".take(80)),
        )
        val (_, session) = admins.signedIn(AdminRole.SUPPORT)
        val html = page("/admin/shops/$shopId", session).response.contentAsString
        assertTrue(html.contains("bağlı bir Google Play aboneliği yok"))
        assertFalse(html.contains("cetele_pro_old"))
        assertFalse(html.contains("REPLACED"))
    }
}
