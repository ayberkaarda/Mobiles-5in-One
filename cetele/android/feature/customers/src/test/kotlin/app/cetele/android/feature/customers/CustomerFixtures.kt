package app.cetele.android.feature.customers

import app.cetele.android.core.domain.model.Customer
import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.core.domain.model.LedgerEntry
import app.cetele.android.core.domain.model.Money
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.domain.model.ShopPlan
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.domain.model.ShopType
import java.time.Instant
import java.time.LocalDate

internal val sampleTime: Instant = Instant.parse("2026-10-06T10:00:00Z")

internal fun sampleShop(
    id: String = "shop-one",
    role: ShopRole = ShopRole.OWNER,
): Shop = Shop(id, "Örnek dükkân", ShopType.BAKKAL, "İstanbul", "Kadıköy", ShopPlan.FREE, role, sampleTime)

internal fun sampleCustomer(
    id: String = "customer-one",
    name: String = "İşık Şen",
    shopId: String = "shop-one",
): Customer = Customer(id, shopId, name, "+905321234567", null, null, false, null, null, sampleTime, sampleTime, null)

internal fun sampleEntry(
    id: String = "entry-one",
    type: EntryType = EntryType.DEBT,
    amount: Long = 125000,
    reversedBy: String? = null,
    reverses: String? = null,
): LedgerEntry =
    LedgerEntry(
        id,
        "shop-one",
        "customer-one",
        type,
        Money(amount),
        LocalDate.of(2026, 10, 6),
        null,
        null,
        null,
        reverses,
        reversedBy,
        null,
        sampleTime,
    )
