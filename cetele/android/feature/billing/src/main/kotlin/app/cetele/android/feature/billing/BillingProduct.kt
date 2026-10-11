package app.cetele.android.feature.billing

import java.security.MessageDigest
import java.util.Locale

/** The single Play subscription product and its base plans (ADR-0031). */
object BillingProduct {
    const val PRODUCT_ID = "cetele_pro"
    const val MONTHLY = "monthly"
    const val YEARLY = "yearly"
    const val PACKAGE_NAME = "app.cetele.android"

    /** Play's subscription centre for Çetele Pro; also linked from the deletion screens (spec item 21). */
    const val MANAGE_URL = "https://play.google.com/store/account/subscriptions?sku=$PRODUCT_ID&package=$PACKAGE_NAME"
}

/**
 * `obfuscatedAccountId` of a purchase for a shop: `lowercase_hex(SHA-256(UTF-8(shopId)))` with the shop id in
 * canonical lowercase UUID text. The server refuses a purchase whose identifier does not match the path shop.
 */
object ObfuscatedAccountId {
    fun of(shopId: String): String = sha256Hex(shopId.lowercase(Locale.ROOT))
}

/** Unique work key of a link retry: `billing-link-` plus the first 16 hex characters of SHA-256 of the token. */
object PurchaseTokenKey {
    private const val PREFIX_LENGTH = 16

    fun workName(purchaseToken: String): String = "billing-link-" + sha256Hex(purchaseToken).take(PREFIX_LENGTH)
}

internal fun sha256Hex(value: String): String =
    MessageDigest
        .getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { byte -> "%02x".format(Locale.ROOT, byte) }
