package app.cetele.android.feature.export

import app.cetele.android.core.domain.ledger.StatementRow
import app.cetele.android.core.domain.model.Customer
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.feature.export.csv.CsvRow

data class ExportSnapshot(
    val shop: Shop? = null,
    val customer: Customer? = null,
    val rows: List<StatementRow> = emptyList(),
    val csvRows: List<CsvRow> = emptyList(),
    val loading: Boolean = true,
    val available: Boolean = false,
    val allEntries: Boolean = false,
)
