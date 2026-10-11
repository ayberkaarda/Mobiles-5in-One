package app.cetele.server.web.site

import app.cetele.server.web.site.content.SiteContent
import app.cetele.server.web.site.seo.SiteFiles
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.springframework.core.io.DefaultResourceLoader
import tools.jackson.databind.json.JsonMapper
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SiteFilesTest {
    private val fingerprint = (0 until 32).joinToString(":") { "%02X".format(it * 7 % 256) }

    private fun files(properties: SiteProperties) = SiteFiles(properties, SiteContent(properties, DefaultResourceLoader()))

    private fun properties(fingerprints: List<String> = emptyList()) =
        SiteProperties(contentLocation = SiteContentFilesTest.FIXTURES, androidCertFingerprints = fingerprints)

    @Test
    fun `asset links are absent without a configured fingerprint`() {
        assertNull(files(properties()).assetLinks)
        assertNull(files(properties(listOf(""))).assetLinks, "an empty environment value binds as one blank item")
    }

    @Test
    fun `asset links name the app, the fingerprint and the two link paths`() {
        val body = files(properties(listOf(fingerprint))).assetLinks!!
        val statement = items(JsonMapper.builder().build().readTree(body)).single()
        val relation = "delegate_permission/common.handle_all_urls"
        assertEquals(relation, items(statement["relation"]).single().asString())
        val target = statement["target"]
        assertEquals("android_app", target["namespace"].asString())
        assertEquals("app.cetele.android", target["package_name"].asString())
        assertEquals(listOf(fingerprint), items(target["sha256_cert_fingerprints"]).map { it.asString() })
        val components = statement["relation_extensions"][relation]["dynamic_app_link_components"]
        assertEquals(listOf("/s/*", "/invite/*", "*"), items(components).map { it["/"].asString() })
        assertTrue(items(components).last()["exclude"].asBoolean())
    }

    @Test
    fun `a malformed fingerprint or base url stops the application`() {
        assertThrows<IllegalArgumentException> { properties(listOf("aa:bb")) }
        assertThrows<IllegalArgumentException> { properties(listOf(fingerprint.lowercase())) }
        assertThrows<IllegalArgumentException> { SiteProperties(baseUrl = "https://cetele.app/") }
        assertThrows<IllegalArgumentException> { SiteProperties(baseUrl = "https://cetele.app/site") }
        assertThrows<IllegalArgumentException> { SiteProperties(baseUrl = "ftp://cetele.app") }
    }

    @Test
    fun `urls follow the configured base url`() {
        val custom = SiteProperties(baseUrl = "https://ornek.cetele.test", contentLocation = SiteContentFilesTest.FIXTURES)
        val files = files(custom)
        assertTrue(files.sitemap.contains("<loc>https://ornek.cetele.test/sss</loc>"))
        assertTrue(files.robots.endsWith("Sitemap: https://ornek.cetele.test/sitemap.xml\n"))
        assertTrue(files.llms.contains("(https://ornek.cetele.test/rehber)"))
    }

    @Test
    fun `llms full makes internal links absolute and carries every page`() {
        val full = files(properties()).llmsFull
        assertTrue(full.contains("](https://cetele.app/ozellikler)"))
        assertTrue(!full.contains("](/"), "no relative link left")
        SiteRoutes.all.forEach { route -> assertTrue(full.contains("URL: https://cetele.app" + route.path + "\n"), route.path) }
    }
}

/** The elements of a JSON array node. */
fun items(node: tools.jackson.databind.JsonNode): List<tools.jackson.databind.JsonNode> = (0 until node.size()).map { node.get(it) }
