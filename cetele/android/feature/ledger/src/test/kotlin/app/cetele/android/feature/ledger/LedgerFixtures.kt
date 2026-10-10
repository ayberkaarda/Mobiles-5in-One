package app.cetele.android.feature.ledger

import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.core.domain.model.LedgerEntry
import app.cetele.android.core.domain.model.Money
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.domain.model.ShopPlan
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.domain.model.ShopType
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

internal object LedgerFixtures {
    val instant: Instant = Instant.parse("2026-10-06T10:00:00Z")
    val today: LocalDate = LocalDate.of(2026, 10, 6)
    val clock: Clock = Clock.fixed(instant, ZoneOffset.UTC)

    fun shop(id: String = "shop-a") =
        Shop(
            id,
            "Dükkan",
            ShopType.BAKKAL,
            "İstanbul",
            "Kadıköy",
            ShopPlan.FREE,
            ShopRole.OWNER,
            instant,
        )

    fun entry(
        reversedBy: String? = null,
        reverses: String? = null,
    ) = LedgerEntry(
        "entry-a",
        "shop-a",
        "customer-a",
        EntryType.DEBT,
        Money(1250),
        today,
        null,
        "Ekmek",
        null,
        reverses,
        reversedBy,
        "user-a",
        instant,
    )
}
