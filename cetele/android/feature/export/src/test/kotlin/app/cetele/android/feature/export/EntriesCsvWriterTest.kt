package app.cetele.android.feature.export

import app.cetele.android.core.domain.ledger.StatementRows
import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.feature.export.csv.CsvRow
import app.cetele.android.feature.export.csv.EntriesCsvWriter
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.ByteArrayOutputStream

class EntriesCsvWriterTest {
    @Test
    fun bomHeaderAndEmptyFileAreExact() {
        val bytes = write(emptyList())
        assertArrayEquals(byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()), bytes.take(3).toByteArray())
        assertEquals(
            "Müşteri;Telefon;Tür;Tutar;Tarih;Vade;Not;Düzeltme;Kayıt\r\n",
            bytes.drop(3).toByteArray().toString(Charsets.UTF_8),
        )
    }

    @Test
    fun amountDateDueDateAndUnicodeAreWrittenWithoutGrouping() {
        val row = CsvRow(customer, StatementRows.build(listOf(entry(dueOn = date.plusDays(1)))).single())
        val text = text(listOf(row))
        val expected =
            "\"Ayşe\";\"'+905321234567\";\"Borç\";\"1250,00\";\"06.10.2026\";" +
                "\"07.10.2026\";\"\";\"\";\"entry-1\"\r\n"
        assertTrue(text.endsWith(expected))
        assertFalse(text.contains("1.250"))
        val payment =
            CsvRow(customer, StatementRows.build(listOf(entry(type = EntryType.PAYMENT, amount = 1))).single())
        assertTrue(text(listOf(payment)).contains("\"Tahsilat\";\"0,01\""))
    }

    @Test
    fun quotesSeparatorsAndMultilineNotesRoundTripInTheCsvDialect() {
        val note = "Süt; \"peynir\"\r\nİkinci satır"
        val row = CsvRow(customer.copy(name = "Ayşe; Yılmaz"), StatementRows.build(listOf(entry(note = note))).single())
        val text = text(listOf(row))
        assertTrue(text.contains("\"Ayşe; Yılmaz\""))
        assertTrue(text.contains("\"Süt; \"\"peynir\"\"\r\nİkinci satır\""))
        assertFalse(text.replace("\r\n", "").contains('\n'))
    }

    @Test
    fun formulaPrefixesAreNeutralizedAcrossEveryTextColumn() {
        listOf("=1+1", "+1", "-1", "@sum(1)", " \t=1").forEach { value ->
            val person = customer.copy(name = value, phone = value)
            val row =
                CsvRow(person, StatementRows.build(listOf(entry(id = value, note = value, reverses = value))).single())
            val cells = text(listOf(row)).substringAfter("\r\n").trimEnd('\r', '\n').split(';')
            listOf(0, 1, 6, 7, 8).forEach { assertEquals("\"'$value\"", cells[it]) }
        }
    }

    @Test
    fun reversalLinksAndReversedRowsArePreservedAndStreamRemainsOpen() {
        val entries = listOf(entry(reversedBy = "correction"), entry(id = "correction", reverses = "entry-1"))
        val rows = StatementRows.build(entries)
        val output = ByteArrayOutputStream()
        EntriesCsvWriter.write(rows.map { CsvRow(customer, it) }, output)
        output.write('!'.code)
        assertEquals(listOf(0L, 0L), rows.map { it.runningBalance.minor })
        val text = output.toString(Charsets.UTF_8.name())
        assertTrue(text.contains("\"correction\";\"entry-1\""))
        assertTrue(text.contains("\"entry-1\";\"correction\""))
        assertTrue(text.endsWith("\r\n!"))
    }

    private fun write(rows: List<CsvRow>): ByteArray =
        ByteArrayOutputStream().also { EntriesCsvWriter.write(rows, it) }.toByteArray()

    private fun text(rows: List<CsvRow>): String = write(rows).toString(Charsets.UTF_8)
}
