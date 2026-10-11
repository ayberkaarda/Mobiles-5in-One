package app.cetele.server.web.site

import app.cetele.server.web.site.content.ContentParser
import app.cetele.server.web.site.content.SiteContent
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.springframework.core.io.DefaultResourceLoader
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The startup check over the fixtures and, once they are merged, over the real content files:
 * every route has its file, and every title and description fits its limit.
 */
class SiteContentFilesTest {
    private val loader = DefaultResourceLoader()

    private fun load(location: String) = SiteContent(SiteProperties(contentLocation = location), loader)

    @Test
    fun `fixtures cover every route and respect the limits`() {
        val content = load(FIXTURES)
        assertEquals(SiteRoutes.all.count { it.content != null }, content.all().size)
        assertLimits(content)
    }

    @Test
    fun `the real content files cover every route and respect the limits`() {
        assumeTrue(loader.getResource(SiteProperties.DEFAULT_CONTENT_LOCATION + "pages/home.md").exists(), "content not merged yet")
        val content = load(SiteProperties.DEFAULT_CONTENT_LOCATION)
        assertLimits(content)
        assertTrue(content.of("/sss").faq.size >= 1)
    }

    @Test
    fun `a missing file stops the application with every missing route listed`() {
        val error = assertThrows<IllegalStateException> { load("classpath:content-missing/") }
        val message = error.message.orEmpty()
        SiteRoutes.all.mapNotNull { it.content }.forEach { ref -> assertTrue(message.contains(ref.file), "${ref.file} in $message") }
    }

    @Test
    fun `the page without a content file has fixed texts within the limits`() {
        val meta = SiteRoutes.GUIDE_INDEX_META
        assertTrue(meta.title.length <= ContentParser.TITLE_MAX)
        assertTrue(meta.description.length <= ContentParser.DESCRIPTION_MAX)
        assertTrue(meta.lead.isNotBlank())
    }

    @Test
    fun `the registry has the routes of the specification`() {
        val expected =
            listOf("/", "/ozellikler", "/fiyatlandirma") +
                listOf("bakkal", "manav", "kasap", "berber").map { "/esnaf-icin/$it" } +
                "/rehber" +
                SiteRoutes.GUIDE_SLUGS.map { "/rehber/$it" } +
                listOf("/sss", "/hakkinda", "/gizlilik", "/kvkk-aydinlatma", "/hesap-silme", "/iletisim")
        assertEquals(expected, SiteRoutes.all.map { it.path })
        assertEquals(5, SiteRoutes.GUIDE_SLUGS.size)
        assertEquals(
            SiteRoutes.all.size,
            SiteRoutes.all
                .map { it.path }
                .toSet()
                .size,
        )
    }

    private fun assertLimits(content: SiteContent) {
        content.all().forEach { (path, page) ->
            assertTrue(page.title.codePointCount(0, page.title.length) <= ContentParser.TITLE_MAX, "title of $path")
            assertTrue(page.description.codePointCount(0, page.description.length) <= ContentParser.DESCRIPTION_MAX, "description of $path")
            assertTrue(page.lead.isNotBlank(), "lead of $path")
        }
        assertTrue(content.of("/sss").faq.isNotEmpty())
    }

    companion object {
        const val FIXTURES = "classpath:content-fixtures/"
    }
}
