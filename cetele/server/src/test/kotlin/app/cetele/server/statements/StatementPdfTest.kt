package app.cetele.server.statements

import app.cetele.server.support.IntegrationTest
import org.apache.pdfbox.Loader
import org.apache.pdfbox.text.PDFTextStripper
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@IntegrationTest
class StatementPdfTest : StatementTestSupport() {
    @Test
    fun `pdf embeds fonts and paginates all rows with totals`() {
        val w = world()
        val turkish = "Çiğdem Şahin İğneci ıöü"
        val c = ledger().customer(w.shopId, name = turkish)
        repeat(120) { ledger().entry(w.shopId, c, amountMinor = 100, note = "Row ${it + 1}") }
        val response = pdf(w, c)
        assertEquals(200, response.status)
        assertEquals("application/pdf", response.contentType)
        assertEquals(
            "attachment; filename=\"hesap-dokumu.pdf\"; filename*=UTF-8''hesap-d%C3%B6k%C3%BCm%C3%BC.pdf",
            response.getHeader("Content-Disposition"),
        )
        Loader.loadPDF(response.contentAsByteArray).use { document ->
            assertTrue(document.numberOfPages >= 4)
            val text = PDFTextStripper().getText(document)
            assertTrue(text.contains(turkish))
            assertTrue(text.contains("Hesap Dökümü"))
            assertTrue(text.contains("Row 120"))
            repeat(120) { assertTrue(text.contains("Row ${it + 1}")) }
            assertTrue(text.contains("Güncel bakiye: ₺120,00"))
            document.pages.forEach { page -> page.resources.fontNames.forEach { assertTrue(page.resources.getFont(it).isEmbedded) } }
        }
    }
}
