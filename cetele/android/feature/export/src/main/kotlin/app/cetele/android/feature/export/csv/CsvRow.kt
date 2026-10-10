package app.cetele.android.feature.export.csv

import app.cetele.android.core.domain.ledger.StatementRow
import app.cetele.android.core.domain.model.Customer

data class CsvRow(
    val customer: Customer,
    val statement: StatementRow,
)
