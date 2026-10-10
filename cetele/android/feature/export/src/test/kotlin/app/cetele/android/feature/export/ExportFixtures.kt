package app.cetele.android.feature.export

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

internal val date: LocalDate = LocalDate.of(2026, 10, 6)
internal val instant: Instant = Instant.parse("2026-10-06T09:00:00Z")
internal val shop =
    Shop("shop-1", "Çınar Bakkalı", ShopType.BAKKAL, "İstanbul", "Kadıköy", ShopPlan.FREE, ShopRole.OWNER, instant)
internal val customer =
    Customer("customer-1", shop.id, "Ayşe", "+905321234567", null, null, false, null, null, instant, instant, null)

@Suppress("LongParameterList")
internal fun entry(
    id: String = "entry-1",
    type: EntryType = EntryType.DEBT,
    amount: Long = 125000,
    note: String? = null,
    dueOn: LocalDate? = null,
    reverses: String? = null,
    reversedBy: String? = null,
): LedgerEntry =
    LedgerEntry(
        id,
        shop.id,
        customer.id,
        type,
        Money(amount),
        date,
        dueOn,
        note,
        null,
        reverses,
        reversedBy,
        null,
        instant,
    )
