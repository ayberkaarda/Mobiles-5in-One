package app.cetele.server.billing

import app.cetele.server.billing.play.FakePlayDeveloperApi
import app.cetele.server.billing.play.PlayAckResult
import app.cetele.server.billing.play.PlaySubscriptionPurchase
import app.cetele.server.billing.play.PlaySubscriptionResult
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.util.Base64
import java.util.UUID
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PurchaseTokensTest {
    private val shop = UUID.fromString("01928c3e-5f6a-7b8c-9d0e-1f2a3b4c5d6e")

    @Test
    fun `handoff test vectors`() {
        assertEquals("775ddbc0c97c6683bb78cafdffea51471b53ceb7fbd89993ed36e130430db621", PurchaseTokens.obfuscatedAccountId(shop))
        assertEquals(64, PurchaseTokens.obfuscatedAccountId(shop).length)
        assertEquals(
            "a8bacd564eb7c299facdf0c5365c05f9b5179a69b2ce48f8f537838bb3755c83",
            PurchaseTokens.hash("fake.sub.active.01928c3e-5f6a-7b8c-9d0e-1f2a3b4c5d6e"),
        )
    }

    @Test
    fun `token format accepts the documented alphabet only`() {
        assertTrue(PurchaseTokens.isWellFormed("abc.DEF_123-x"))
        assertTrue(PurchaseTokens.isWellFormed("a".repeat(4096)))
        assertFalse(PurchaseTokens.isWellFormed(""))
        assertFalse(PurchaseTokens.isWellFormed("a".repeat(4097)))
        assertFalse(PurchaseTokens.isWellFormed("a b"))
        assertFalse(PurchaseTokens.isWellFormed("a/b"))
    }

    @Test
    fun `cipher uses the documented layout and refuses other keys and data`() {
        val key = ByteArray(32) { it.toByte() }
        val cipher = PurchaseTokenCipher(key)
        val token = "fake.sub.active.$shop"
        val sealed = cipher.encrypt(token)
        assertEquals(PurchaseTokenCipher.VERSION, sealed[0])
        assertEquals(1 + 12 + token.length + 16, sealed.size)
        assertEquals(token, cipher.decrypt(sealed))
        // A fresh nonce every time.
        assertFalse(sealed.contentEquals(cipher.encrypt(token)))
        assertNull(PurchaseTokenCipher(ByteArray(32) { 9 }).decrypt(sealed))
        assertNull(cipher.decrypt(sealed.copyOf().also { it[20] = (it[20] + 1).toByte() }))
        assertNull(cipher.decrypt(sealed.copyOf().also { it[0] = 2 }))
        assertNull(cipher.decrypt(byteArrayOf(1, 2, 3)))
        assertNull(cipher.decrypt(null))
        // The additional data binds the purpose: a plain AES-GCM decryption without it fails.
        val plain = Cipher.getInstance("AES/GCM/NoPadding")
        plain.init(
            Cipher.DECRYPT_MODE,
            SecretKeySpec(key, "AES"),
            GCMParameterSpec(128, sealed, 1, 12),
        )
        assertFailsWith<AEADBadTagException> { plain.doFinal(sealed, 13, sealed.size - 13) }
        assertContentEquals(key, Base64.getDecoder().decode(Base64.getEncoder().encodeToString(key)))
        assertEquals(token, PurchaseTokenCipher.fromBase64(Base64.getEncoder().encodeToString(key)).decrypt(sealed))
        assertFailsWith<IllegalArgumentException> { PurchaseTokenCipher(ByteArray(16)) }
    }

    @Test
    fun `fake play adapter follows the documented grammar`() {
        val now = Instant.parse("2026-10-11T09:30:00Z")
        val fake = FakePlayDeveloperApi("cetele_pro", Clock.fixed(now, ZoneOffset.UTC))

        fun found(state: String): PlaySubscriptionPurchase =
            assertIs<PlaySubscriptionResult.Found>(fake.getSubscription(FakePlayDeveloperApi.token(state, shop, "t1"))).purchase

        val expected =
            mapOf(
                "active" to (PlaySubscriptionPurchase.STATE_ACTIVE to Duration.ofDays(30)),
                "grace" to (PlaySubscriptionPurchase.STATE_IN_GRACE_PERIOD to Duration.ofDays(3)),
                "canceled" to (PlaySubscriptionPurchase.STATE_CANCELED to Duration.ofDays(10)),
                "hold" to (PlaySubscriptionPurchase.STATE_ON_HOLD to Duration.ofDays(-1)),
                "paused" to (PlaySubscriptionPurchase.STATE_PAUSED to Duration.ofDays(-1)),
                "expired" to (PlaySubscriptionPurchase.STATE_EXPIRED to Duration.ofDays(-1)),
            )
        expected.forEach { (state, pair) ->
            val purchase = found(state)
            assertEquals(pair.first, purchase.subscriptionState, state)
            assertEquals(now.plus(pair.second), purchase.lineItemFor("cetele_pro")!!.expiryTime, state)
            assertEquals(PurchaseTokens.obfuscatedAccountId(shop), purchase.obfuscatedExternalAccountId)
            assertTrue(purchase.testPurchase)
            assertTrue(purchase.acknowledgementPending)
        }
        assertFalse(found("canceled").lineItemFor("cetele_pro")!!.autoRenewEnabled)
        assertNull(found("pending").lineItemFor("cetele_pro")!!.expiryTime)
        assertNull(found("otherproduct").lineItemFor("cetele_pro"))
        assertEquals("cetele_other", found("otherproduct").lineItems.single().productId)
        assertEquals(PlaySubscriptionResult.NotFound, fake.getSubscription(FakePlayDeveloperApi.token("unknown", shop)))
        assertEquals(PlaySubscriptionResult.Unavailable("fake"), fake.getSubscription(FakePlayDeveloperApi.token("unavailable", shop)))
        listOf(
            "fake.sub.active.${shop.toString().uppercase()}",
            "fake.sub.active.$shop.UPPERCASE",
            "fake.sub.active.$shop.abcdefghijklmnopq",
            "fake.sub.active.not-a-uuid",
            "something.else",
            "fake.sub.bogus.$shop",
        ).forEach { assertEquals(PlaySubscriptionResult.NotFound, fake.getSubscription(it), it) }
        assertIs<PlaySubscriptionResult.Found>(fake.getSubscription(FakePlayDeveloperApi.token("active", shop, "abcdefghijklmnop")))

        val token = FakePlayDeveloperApi.token("active", shop, "ack")
        fake.refuseAcknowledgement(token)
        assertIs<PlayAckResult.Unavailable>(fake.acknowledge("cetele_pro", token))
        fake.allowAcknowledgement(token)
        assertEquals(PlayAckResult.Acknowledged, fake.acknowledge("cetele_pro", token))
        assertTrue(found("active").acknowledgementPending)
        val acknowledged = assertIs<PlaySubscriptionResult.Found>(fake.getSubscription(token)).purchase
        assertEquals(PlaySubscriptionPurchase.ACKNOWLEDGED, acknowledged.acknowledgementState)
        assertEquals(listOf(token), fake.acknowledgements())
        assertEquals(
            PlayAckResult.NotFound,
            fake.acknowledge("cetele_pro", FakePlayDeveloperApi.token("unknown", shop)),
        )
    }
}
