package app.cetele.server.web.site.content

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.time.LocalDate
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ContentParserTest {
    private fun source(
        title: String = "Veresiye Defteri Nasıl Tutulur?",
        description: String = "Defteri düzenli tutmak için kısa ve uygulanabilir adımlar.",
        slug: String = "ornek",
        extra: String = "",
        body: String = "## Kısaca\n\nKısaca: düzenli yazın.\n",
    ) = "---\nslug: $slug\ntitle: \"$title\"   # yorum\ndescription: \"$description\"\nupdated: 2026-10-11\n" +
        "lead: \"Çetele'nin tanımı: internet olmadan da yazan bir defter.\"\nkeywords: [veresiye defteri, alacak takibi]\n" +
        "breadcrumb: \"Rehber\"\n$extra---\n$body"

    @Test
    fun `front matter keys and body are read`() {
        val page = ContentParser.parse("guides/ornek.md", "ornek", source())
        assertEquals("Veresiye Defteri Nasıl Tutulur?", page.title)
        assertEquals(LocalDate.of(2026, 10, 11), page.updated)
        assertEquals(listOf("veresiye defteri", "alacak takibi"), page.keywords)
        assertEquals("Rehber", page.breadcrumb)
        assertTrue(page.lead.startsWith("Çetele'nin tanımı"))
        assertTrue(page.html.value.contains("<h2>Kısaca</h2>"))
    }

    @Test
    fun `windows line endings and a byte order mark are accepted`() {
        val text = "" + source().replace("\n", "\r\n")
        val page = ContentParser.parse("guides/ornek.md", "ornek", text)
        assertEquals("ornek", page.slug)
        assertEquals("## Kısaca\n\nKısaca: düzenli yazın.", page.markdown)
    }

    @Test
    fun `faq items are read as question and answer pairs`() {
        val faq = "faq:\n- q: \"Soru bir?\"\n  a: \"Cevap bir.\"\n- q: \"Soru iki?\"\n  a: \"Cevap iki.\"\n"
        val page = ContentParser.parse("pages/sss.md", "ornek", source(extra = faq))
        assertEquals(listOf(FaqItem("Soru bir?", "Cevap bir."), FaqItem("Soru iki?", "Cevap iki.")), page.faq)
    }

    @Test
    fun `limits and the slug are enforced`() {
        val longTitle = "a".repeat(ContentParser.TITLE_MAX + 1)
        val longDescription = "b".repeat(ContentParser.DESCRIPTION_MAX + 1)
        val error =
            assertThrows<ContentException> {
                ContentParser.parse("pages/x.md", "baska", source(title = longTitle, description = longDescription))
            }
        val message = error.message.orEmpty()
        assertTrue(message.contains("title is longer than 60"), message)
        assertTrue(message.contains("description is longer than 155"), message)
        assertTrue(message.contains("must equal the file name"), message)
    }

    @Test
    fun `a title of exactly 60 Turkish characters is accepted`() {
        val title = "ÇĞİÖŞÜ".repeat(10)
        assertEquals(60, title.length)
        ContentParser.parse("pages/x.md", "ornek", source(title = title))
    }

    @Test
    fun `a file without front matter or with a broken one is rejected`() {
        assertThrows<ContentException> { ContentParser.parse("pages/x.md", "x", "## Başlık\n") }
        assertThrows<ContentException> { ContentParser.parse("pages/x.md", "x", "---\nslug: x\n## Başlık\n") }
        assertThrows<ContentException> { ContentParser.parse("pages/x.md", "x", "---\n- liste\n---\nGövde\n") }
        assertThrows<ContentException> {
            ContentParser.parse(
                "pages/x.md",
                "ornek",
                source().replace("updated: 2026-10-11", "updated: dün"),
            )
        }
    }

    @Test
    fun `yaml type tags cannot create objects`() {
        val tagged = source(extra = "x: !!java.io.File \"/tmp\"\n")
        assertThrows<ContentException> { ContentParser.parse("pages/x.md", "ornek", tagged) }
    }

    @Test
    fun `markdown escapes raw html, drops unsafe links and keeps a single h1`() {
        val body =
            "# Birinci\n\n<script>alert(1)</script>\n\n" +
                "Metin <b onclick=\"x()\">kalın</b> [bağlantı](javascript:alert(1)) [veri](data:text/html,x) [iç](/sss)\n"
        val html = MarkdownRenderer.render(body).value
        assertFalse(html.contains("<h1"), html)
        assertTrue(html.contains("<h2>Birinci</h2>"), html)
        assertFalse(html.contains("<script"), html)
        assertFalse(html.contains("<b "), html)
        assertTrue(html.contains("&lt;script&gt;"), html)
        assertFalse(html.contains("javascript:") || html.contains("data:"), html)
        assertTrue(html.contains("<a href=\"/sss\">iç</a>"), html)
    }

    @Test
    fun `tables render`() {
        val html = MarkdownRenderer.render("| A | B |\n| --- | --- |\n| 1 | 2 |\n").value
        assertTrue(html.contains("<table>") && html.contains("<td>2</td>"), html)
    }
}
