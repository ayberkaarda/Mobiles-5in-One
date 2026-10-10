package app.cetele.android.feature.export

import app.cetele.android.core.data.repository.CustomerListItem
import app.cetele.android.core.data.repository.CustomerRepository
import app.cetele.android.core.domain.ledger.StatementRows
import app.cetele.android.core.domain.model.LedgerEntry
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.feature.export.csv.CsvRow
import kotlinx.coroutines.flow.first

internal suspend fun csvSnapshot(
    customers: CustomerRepository,
    shop: Shop,
    people: List<CustomerListItem>,
    entries: List<LedgerEntry>,
): ExportSnapshot {
    val byId = people.associate { it.customer.id to it.customer }.toMutableMap()
    for (id in entries.map { it.customerId }.distinct()) {
        if (id !in byId) {
            val customer =
                customers.observe(shop.id, id).first()
                    ?: return ExportSnapshot(shop = shop, loading = false)
            byId[id] = customer
        }
    }
    val rows =
        entries
            .groupBy { it.customerId }
            .values
            .flatMap(StatementRows::build)
            .sortedWith(compareBy({ it.entry.occurredOn }, { it.entry.createdAt }, { it.entry.id }))
            .map { CsvRow(requireNotNull(byId[it.entry.customerId]), it) }
    return ExportSnapshot(shop = shop, csvRows = rows, loading = false, available = true, allEntries = true)
}

internal fun canExport(
    data: ExportSnapshot,
    request: ExportTarget,
    busy: Boolean,
): Boolean {
    val ready = !busy && !data.loading && data.available
    val ownerAllowed = request.customerId != null || data.shop?.role == ShopRole.OWNER
    val targetMatches =
        if (request.customerId == null) data.allEntries else data.customer?.id == request.customerId
    return ready && ownerAllowed && targetMatches
}
