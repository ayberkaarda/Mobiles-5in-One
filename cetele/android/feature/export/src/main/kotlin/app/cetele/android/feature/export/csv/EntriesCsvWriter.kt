package app.cetele.android.feature.export.csv

import app.cetele.android.core.domain.format.DateFormats
import app.cetele.android.core.domain.model.EntryType
import java.io.OutputStream
import java.math.BigDecimal

object EntriesCsvWriter {
    private const val HEADER = "Müşteri;Telefon;Tür;Tutar;Tarih;Vade;Not;Düzeltme;Kayıt\r\n"
    private val bom = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte())

    fun write(
        rows: List<CsvRow>,
        out: OutputStream,
    ) {
        out.write(bom)
        out.write(HEADER.toByteArray(Charsets.UTF_8))
        rows.forEach { row ->
            val entry = row.statement.entry
            val cells =
                listOf(
                    row.customer.name,
                    row.customer.phone.orEmpty(),
                    if (entry.type == EntryType.DEBT) "Borç" else "Tahsilat",
                    BigDecimal.valueOf(entry.amount.minor, 2).toPlainString().replace('.', ','),
                    DateFormats.short(entry.occurredOn),
                    entry.dueOn?.let(DateFormats::short).orEmpty(),
                    entry.note.orEmpty(),
                    entry.reverses ?: entry.reversedBy.orEmpty(),
                    entry.id,
                )
            out.write((cells.joinToString(";", transform = ::cell) + "\r\n").toByteArray(Charsets.UTF_8))
        }
        out.flush()
    }

    private fun cell(value: String): String {
        val safe = if (value.trimStart().firstOrNull() in listOf('=', '+', '-', '@')) "'$value" else value
        return "\"${safe.replace("\"", "\"\"")}\""
    }
}
