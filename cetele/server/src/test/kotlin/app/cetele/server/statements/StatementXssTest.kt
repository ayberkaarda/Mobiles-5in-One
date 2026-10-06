package app.cetele.server.statements

import app.cetele.server.support.IntegrationTest
import org.apache.pdfbox.Loader
import org.apache.pdfbox.text.PDFTextStripper
import org.junit.jupiter.api.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@IntegrationTest
class StatementXssTest : StatementTestSupport() {
    @Test
    fun `html escapes stored text while pdf preserves literal text`() {
        val w = world()
        val shop = "Shop \"Quoted\" & Sons"
        jdbc.update("UPDATE shops SET name = ? WHERE id = ?", shop, w.shopId)
        val name = "<script>alert(1)</script>"
        val c = ledger().customer(w.shopId, name = name)
        val link = links.issue(w.shopId, c, w.owner.id, now = clock.instant())
        val html = open(link.token).contentAsString
        assertFalse(html.contains(name))
        assertTrue(html.contains("&lt;script&gt;alert(1)&lt;/script&gt;"))
        assertTrue(html.contains("Shop &quot;Quoted&quot; &amp; Sons"))
        Loader.loadPDF(pdf(w, c).contentAsByteArray).use { document ->
            val text = PDFTextStripper().getText(document)
            assertTrue(text.contains(name))
            assertTrue(text.contains(shop))
        }
    }
}
