package app.cetele.android.feature.billing

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.util.Locale

class ObfuscatedAccountIdTest {
    @Test
    fun `shop id hashes to the contract test vector`() {
        assertEquals(SHOP_HASH, ObfuscatedAccountId.of(SHOP_ID))
        assertEquals(64, ObfuscatedAccountId.of(SHOP_ID).length)
    }

    @Test
    fun `upper case shop id text is hashed in canonical lower case even under a turkish locale`() {
        val previous = Locale.getDefault()
        try {
            Locale.setDefault(Locale.forLanguageTag("tr-TR"))
            assertEquals(SHOP_HASH, ObfuscatedAccountId.of(SHOP_ID.uppercase(Locale.ROOT)))
        } finally {
            Locale.setDefault(previous)
        }
    }

    @Test
    fun `link retry work name uses the first sixteen hex of the token hash`() {
        // Server vector: SHA-256 of this token is a8bacd564eb7c299facdf0c5365c05f9b5179a69b2ce48f8f537838bb3755c83.
        assertEquals("billing-link-a8bacd564eb7c299", PurchaseTokenKey.workName("fake.sub.active.$SHOP_ID"))
    }

    @Test
    fun `manage link points at the play subscription centre of the product`() {
        assertEquals(
            "https://play.google.com/store/account/subscriptions?sku=cetele_pro&package=app.cetele.android",
            BillingProduct.MANAGE_URL,
        )
    }
}
