package app.cetele.android.core.domain

import app.cetele.android.core.domain.model.Customer
import app.cetele.android.core.domain.model.LedgerEntry
import java.time.Instant
import java.time.LocalDate

internal val today: LocalDate = LocalDate.of(2026, 10, 6)
internal val createdAt: Instant = Instant.parse("2026-10-06T08:00:00Z")

internal fun customer(
    id: String = "customer-one",
    name: String = "Ayşe",
    shopId: String = "shop-one",
    deletedAt: Instant? = null,
): Customer = Customer(id, shopId, name, null, null, null, false, null, null, createdAt, createdAt, deletedAt)

@Suppress("LongParameterList")
internal fun entry(
    id: String = "entry-one",
    customerId: String = "customer-one",
    type: EntryType = EntryType.DEBT,
    amountMinor: Long = 1250,
    occurredOn: LocalDate = today,
    dueOn: LocalDate? = null,
    reverses: String? = null,
    reversedBy: String? = null,
    created: Instant = createdAt,
    shopId: String = "shop-one",
): LedgerEntry =
    LedgerEntry(
        id,
        shopId,
        customerId,
        type,
        Money(amountMinor),
        occurredOn,
        dueOn,
        null,
        null,
        reverses,
        reversedBy,
        null,
        created,
    )
