package app.cetele.server.web.site

import app.cetele.server.security.SecurityHeadersConfig
import app.cetele.server.support.IntegrationTest
import app.cetele.server.web.site.content.ContentParser
import app.cetele.server.web.site.content.SiteContent
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpHeaders
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.head
import org.springframework.test.web.servlet.post
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

@IntegrationTest
class SiteWebTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val content: SiteContent,
    @Autowired private val properties: SiteProperties,
    @Autowired private val pages: SitePages,
) {
    private val json = JsonMapper.builder().build()
    private val base = SiteProperties.DEFAULT_BASE_URL

    @Test
    fun `every registry route renders one page with its meta`() {
        assertEquals(base, properties.baseUrl)
        SiteRoutes.all.forEach { route ->
            val result = get(route.path)
            val response = result.response
            assertEquals(200, response.status, route.path)
            assertEquals("text/html;charset=UTF-8", response.contentType?.replace(" ", ""), route.path)
            val html = response.contentAsString
            val canonical = base + route.path
            val title = Regex("<title>([^<]*)</title>").find(html)!!.groupValues[1]
            val description = Regex("<meta name=\"description\" content=\"([^\"]*)\">").find(html)!!.groupValues[1]
            assertTrue(unescape(title).length <= ContentParser.TITLE_MAX, "title of ${route.path}")
            assertTrue(unescape(description).length <= ContentParser.DESCRIPTION_MAX, "description of ${route.path}")
            assertTrue(html.startsWith("<!doctype html>\n<html lang=\"tr\""), route.path)
            assertEquals(1, Regex("<h1[ >]").findAll(html).count(), "one h1 on ${route.path}")
            assertTrue(html.contains("<link rel=\"canonical\" href=\"$canonical\">"), route.path)
            assertTrue(html.contains("<link rel=\"alternate\" hreflang=\"tr-TR\" href=\"$canonical\">"), route.path)
            assertTrue(html.contains("<link rel=\"alternate\" hreflang=\"x-default\" href=\"$canonical\">"), route.path)
            assertTrue(html.contains("<meta name=\"robots\" content=\"${SitePages.INDEX}\">"), route.path)
            assertTrue(html.contains("<meta property=\"og:url\" content=\"$canonical\">"), route.path)
            assertTrue(html.contains("<meta property=\"og:image\" content=\"$base/assets/site/og-cetele.png\">"), route.path)
            assertTrue(html.contains("<meta name=\"twitter:card\" content=\"summary_large_image\">"), route.path)
            assertTrue(html.contains("<a class=\"skip\" href=\"#main\">"), route.path)
            assertTrue(html.contains("<main id=\"main\""), route.path)
            assertNoInlineCode(html, route.path)
            assertSiteHeaders(response, route.path)
            assertEquals("max-age=300, public", response.getHeader(HttpHeaders.CACHE_CONTROL), route.path)
            assertNotNull(response.getHeader(HttpHeaders.ETAG), route.path)
        }
    }

    @Test
    fun `an unknown slug or a deeper path gets the 404 page`() {
        listOf("/rehber/yok-boyle-bir-yazi", "/esnaf-icin/kuyumcu").forEach { path ->
            val response = get(path).response
            assertEquals(404, response.status, path)
            val html = response.contentAsString
            assertTrue(html.contains("<h1>Sayfa bulunamadı</h1>"), path)
            assertTrue(html.contains("<meta name=\"robots\" content=\"noindex, nofollow\">"), path)
            assertFalse(html.contains("rel=\"canonical\""), path)
            assertFalse(html.contains("application/ld+json"), path)
            assertEquals("no-store", response.getHeader(HttpHeaders.CACHE_CONTROL))
            assertEquals("noindex, nofollow", response.getHeader("X-Robots-Tag"))
            assertSiteHeaders(response, path)
        }
        assertEquals(401, get("/rehber/a/b").response.status, "outside the site chain")
    }

    @Test
    fun `structured data parses and carries the expected types`() {
        val home = graph("/")
        assertEquals(setOf("Organization", "WebSite", "MobileApplication", "WebPage"), types(home))
        val app = home.single { it["@type"].asString() == "MobileApplication" }
        assertEquals("Android", app["operatingSystem"].asString())
        assertEquals("BusinessApplication", app["applicationCategory"].asString())
        val offer = app["offers"]
        assertTrue(offer.isObject, "a single offer")
        assertEquals("Free", offer["name"].asString())
        assertEquals("0", offer["price"].asString())
        assertEquals("TRY", offer["priceCurrency"].asString())
        assertTrue(app["description"].asString().contains("Google Play'de gösterilir"))

        val faq = graph("/sss")
        assertEquals(setOf("Organization", "WebSite", "FAQPage", "BreadcrumbList"), types(faq))
        val questions = faq.single { it["@type"].asString() == "FAQPage" }["mainEntity"]
        assertEquals(content.of("/sss").faq.map { it.question }, items(questions).map { it["name"].asString() })
        assertEquals(content.of("/sss").faq.map { it.answer }, items(questions).map { it["acceptedAnswer"]["text"].asString() })

        SiteRoutes.guides.forEach { route ->
            val nodes = graph(route.path)
            assertEquals(setOf("Organization", "WebSite", "WebPage", "Article", "BreadcrumbList"), types(nodes))
            val article = nodes.single { it["@type"].asString() == "Article" }
            assertEquals(content.of(route).updated.toString(), article["dateModified"].asString(), route.path)
            val crumbs = nodes.single { it["@type"].asString() == "BreadcrumbList" }["itemListElement"]
            assertEquals(listOf("$base/", "$base/rehber", base + route.path), items(crumbs).map { it["item"].asString() })
        }
        assertEquals("CollectionPage", graph("/rehber").single { it["@type"].asString() == "CollectionPage" }["@type"].asString())
        assertTrue("MobileApplication" in types(graph("/esnaf-icin/bakkal")))
        assertFalse("MobileApplication" in types(graph("/gizlilik")))
        SiteRoutes.all.forEach { route ->
            val offers = graph(route.path).mapNotNull { it["offers"] }
            assertTrue(offers.all { it.isObject && it["price"].asString() == "0" }, "only the free offer on ${route.path}")
        }
    }

    @Test
    fun `the guide body is escaped and keeps one heading level 1`() {
        val html = get("/rehber/veresiye-defteri-nasil-tutulur").response.contentAsString
        assertTrue(html.contains("&lt;script&gt;alert(1)&lt;/script&gt;"))
        assertFalse(html.contains("javascript:"))
        assertTrue(html.contains("<h2>Gövdede birinci düzey başlık</h2>"))
        assertTrue(html.contains("<time datetime=\"2026-10-11\">11 Ekim 2026</time>"))
        assertTrue(html.contains("<meta property=\"og:type\" content=\"article\">"))
    }

    @Test
    fun `pages carry the layout structure of the stylesheet`() {
        val home = get("/").response.contentAsString
        assertTrue(home.contains("<body class=\"page-home\">"))
        val heading = "<h1><span class=\"kicker\">Çetele:</span> <span class=\"main\">Esnafın Dijital Veresiye Defteri</span></h1>"
        assertTrue(home.contains(heading))
        val lead = content.of("/").lead
        val (intro, more) = SitePageView.splitLead(lead)
        assertEquals(lead, intro + " " + more)
        assertTrue(home.contains("<span class=\"intro\">${escape(intro)}</span> <span class=\"more\">${escape(more!!)}</span>"))
        assertTrue(home.contains("<img src=\"/assets/site/screens/musteri-hesabi.png\""))
        assertTrue(home.contains("<figcaption>${Screen.CAPTION}</figcaption>"), "a screenshot is labelled as sample data")
        assertTrue(home.contains("<a class=\"shop\" href=\"/esnaf-icin/bakkal\">"))

        val faq = get("/sss").response.contentAsString
        assertTrue(faq.contains("<body class=\"page-faq\">"))
        assertEquals(content.of("/sss").faq.size, Regex("<details>").findAll(faq).count())
        assertTrue(faq.contains("<summary>Çetele internet olmadan kullanılabilir mi?</summary>"))
        assertFalse(faq.contains("<figure"), "no screenshot on the questions page")

        assertTrue(get("/ozellikler").response.contentAsString.contains("/assets/site/screens/panel.png"))
        SiteRoutes.trades.forEach { route ->
            assertTrue(get(route.path).response.contentAsString.contains("/assets/site/screens/musteriler.png"), route.path)
        }
        listOf("/assets/site/screens/musteri-hesabi.png", "/assets/site/defter.svg", "/assets/site/cetele-cubugu.svg").forEach {
            assertEquals(200, get(it).response.status, it)
        }
        assertTrue(get("/rehber/yok-boyle-bir-yazi").response.contentAsString.contains("<body class=\"page-missing\">"))
    }

    @Test
    fun `the lead splits after its first sentence and a heading at its first colon`() {
        assertEquals("Bir cümle." to "İkinci cümle. Üçüncü.", SitePageView.splitLead("Bir cümle. İkinci cümle. Üçüncü."))
        assertEquals("Tek cümle, 2.5 değil." to null, SitePageView.splitLead("Tek cümle, 2.5 değil."))
        val page = pages.notFound("/rehber/yok-boyle-bir-yazi")
        assertNull(page.headingKicker)
        assertEquals("Sayfa bulunamadı", page.headingMain)
        val features = pages.view(SiteRoutes.get("/ozellikler"))
        assertEquals("Çetele Özellikleri:", features.headingKicker)
        assertEquals("Borç ve Tahsilat Takibi", features.headingMain)
        assertEquals(features.heading, features.headingKicker + " " + features.headingMain)
    }

    @Test
    fun `the sitemap lists exactly the registry`() {
        val response = get("/sitemap.xml").response
        assertEquals(200, response.status)
        assertTrue(response.contentType!!.startsWith("application/xml"))
        val xml = response.contentAsString
        val locs = Regex("<loc>([^<]+)</loc>").findAll(xml).map { it.groupValues[1] }.toList()
        assertEquals(SiteRoutes.all.map { base + it.path }, locs)
        SiteRoutes.all.forEach { route ->
            assertTrue(xml.contains("<loc>$base${route.path}</loc><lastmod>${content.lastModified(route)}</lastmod>"), route.path)
        }
        assertTrue(xml.contains("<loc>$base/rehber</loc><lastmod>2026-10-12</lastmod>"), "the index takes the newest guide")
        assertEquals("max-age=3600, public", response.getHeader(HttpHeaders.CACHE_CONTROL))
        assertSiteHeaders(response, "/sitemap.xml")
    }

    @Test
    fun `robots keeps crawlers out of the console, the statements and the api`() {
        val response = get("/robots.txt").response
        assertEquals(200, response.status)
        assertTrue(response.contentType!!.startsWith("text/plain"))
        assertEquals(
            "User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /s/\nDisallow: /v1/\n\nSitemap: $base/sitemap.xml\n",
            response.contentAsString,
        )
    }

    @Test
    fun `llms files state the plan limits of the server and link every page`() {
        val llms = get("/llms.txt").response.contentAsString
        val free = SiteFacts.free
        val pro = SiteFacts.pro
        assertEquals(100, free.customers)
        assertTrue(llms.contains("${free.customers} müşteri, ayda ${free.photosPerMonth} fotoğraf, ayda ${free.smsPerMonth} SMS"), llms)
        assertTrue(llms.contains("sınırsız müşteri, ayda ${pro.photosPerMonth} fotoğraf, ayda ${pro.smsPerMonth} SMS"), llms)
        assertEquals(Int.MAX_VALUE, pro.customers)
        assertTrue(llms.contains("Google Play'de gösterilir"))
        assertTrue(llms.startsWith("# Çetele\n\n> " + content.of("/").lead + "\n"))
        SiteRoutes.all.forEach { route -> assertTrue(llms.contains("(" + base + route.path + ")"), route.path) }
        assertFalse(Regex("\\d+[,.]\\d{2} ?(TL|₺)|₺ ?\\d").containsMatchIn(llms), "no price")

        val full = get("/llms-full.txt").response.contentAsString
        assertTrue(full.startsWith(llms.substringBefore("## Sayfalar")))
        SiteRoutes.all.forEach { route ->
            route.content?.let { assertTrue(full.contains(content.of(route).lead), route.path) }
        }
        content.of("/sss").faq.forEach { assertTrue(full.contains("### " + it.question + "\n\n" + it.answer)) }
    }

    @Test
    fun `asset links answer 404 while no fingerprint is configured`() {
        val response = get("/.well-known/assetlinks.json").response
        assertEquals(404, response.status)
        assertEquals("", response.contentAsString)
        assertSiteHeaders(response, "assetlinks")
    }

    @Test
    fun `statement and console pages stay noindex`() {
        val statement = get("/s/unknown-token").response
        assertEquals(404, statement.status)
        assertEquals("noindex, nofollow", statement.getHeader("X-Robots-Tag"))
        assertTrue(statement.contentAsString.contains("<meta name=\"robots\" content=\"noindex, nofollow\">"))
        val console = get("/admin/login").response
        assertEquals(200, console.status)
        assertEquals("noindex, nofollow", console.getHeader("X-Robots-Tag"))
        assertTrue(console.contentAsString.contains("<meta name=\"robots\" content=\"noindex, nofollow\">"))
    }

    @Test
    fun `the site is read only, cookie free and revalidates by etag`() {
        val first = get("/fiyatlandirma")
        assertNull(first.request.getSession(false), "no session")
        assertNull(first.response.getHeader(HttpHeaders.SET_COOKIE))
        val etag = assertNotNull(first.response.getHeader(HttpHeaders.ETAG))
        val second = get("/fiyatlandirma")
        assertEquals(etag, second.response.getHeader(HttpHeaders.ETAG), "byte-identical page")
        val revalidated =
            mvc
                .get("/fiyatlandirma") {
                    secure = true
                    header(HttpHeaders.IF_NONE_MATCH, etag)
                    with { it.apply { remoteAddr = nextIp() } }
                }.andReturn()
                .response
        assertEquals(304, revalidated.status)

        val head = mvc.head("/") { secure = true }.andReturn().response
        assertEquals(200, head.status)

        listOf("/", "/sitemap.xml", "/rehber/alacak-takibi-icin-7-kural").forEach { path ->
            val response =
                mvc
                    .post(path) {
                        secure = true
                        with { it.apply { remoteAddr = nextIp() } }
                    }.andReturn()
                    .response
            assertEquals(405, response.status, path)
            assertEquals("GET, HEAD", response.getHeader(HttpHeaders.ALLOW))
            assertEquals("no-store", response.getHeader(HttpHeaders.CACHE_CONTROL))
            assertSiteHeaders(response, path)
        }
    }

    @Test
    fun `assets are served with a long cache and fit the size budget`() {
        val css = get("/assets/site/site.css").response
        assertEquals(200, css.status)
        assertEquals(SiteSecurityConfig.ASSET_CACHE, css.getHeader(HttpHeaders.CACHE_CONTROL))
        assertTrue(css.contentAsByteArray.size < CSS_BUDGET, "stylesheet under ${CSS_BUDGET / 1024} KiB")
        assertFalse(css.contentAsString.contains("@import"))
        assertSiteHeaders(css, "site.css")
        val fonts = listOf("bricolage-grotesque", "figtree").map { get("/assets/site/fonts/$it.woff2").response }
        fonts.forEach { assertEquals(200, it.status) }
        assertTrue(fonts.sumOf { it.contentAsByteArray.size } < FONT_BUDGET, "fonts under ${FONT_BUDGET / 1024} KiB")
        val og = get("/assets/site/og-cetele.png").response
        assertEquals(200, og.status)
        assertEquals("image/png", og.contentType)
    }

    @Test
    fun `a client over the request budget gets 429 with retry-after`() {
        val ip = "10.250.0.9"
        repeat(properties.requestsPerMinute.toInt()) {
            assertEquals(
                200,
                mvc
                    .get("/robots.txt") { with { r -> r.apply { remoteAddr = ip } } }
                    .andReturn()
                    .response.status,
            )
        }
        val rejected = mvc.get("/robots.txt") { with { r -> r.apply { remoteAddr = ip } } }.andReturn().response
        assertEquals(429, rejected.status)
        assertNotNull(rejected.getHeader(HttpHeaders.RETRY_AFTER))
        assertEquals("no-store", rejected.getHeader(HttpHeaders.CACHE_CONTROL))
        assertEquals(200, get("/robots.txt").response.status, "another client is not affected")
    }

    private fun get(path: String): MvcResult =
        mvc
            .get(path) {
                secure = true
                with { it.apply { remoteAddr = nextIp() } }
            }.andReturn()

    private fun graph(path: String): List<JsonNode> {
        val html = get(path).response.contentAsString
        val blocks = Regex("<script type=\"application/ld\\+json\">(.*?)</script>", RegexOption.DOT_MATCHES_ALL).findAll(html).toList()
        assertEquals(1, blocks.size, path)
        val document = json.readTree(blocks.single().groupValues[1])
        assertEquals("https://schema.org", document["@context"].asString())
        return items(document["@graph"])
    }

    private fun types(nodes: List<JsonNode>): Set<String> = nodes.map { it["@type"].asString() }.toSet()

    private fun assertNoInlineCode(
        html: String,
        path: String,
    ) {
        assertFalse(Regex("<[^>]*\\sstyle\\s*=|<style", RegexOption.IGNORE_CASE).containsMatchIn(html), "inline style on $path")
        assertFalse(Regex("<[^>]*\\son[a-z]+\\s*=", RegexOption.IGNORE_CASE).containsMatchIn(html), "event handler on $path")
        val scripts = Regex("<script[^>]*>", RegexOption.IGNORE_CASE).findAll(html).map { it.value }.toList()
        assertEquals(listOf("<script type=\"application/ld+json\">"), scripts, "only the JSON-LD data block on $path")
    }

    private fun assertSiteHeaders(
        response: MockHttpServletResponse,
        path: String,
    ) {
        assertEquals(SiteSecurityConfig.CSP, response.getHeader("Content-Security-Policy"), path)
        assertEquals(SecurityHeadersConfig.HSTS, response.getHeader("Strict-Transport-Security"), path)
        assertEquals("nosniff", response.getHeader("X-Content-Type-Options"), path)
        assertEquals("DENY", response.getHeader("X-Frame-Options"), path)
        assertEquals("strict-origin-when-cross-origin", response.getHeader("Referrer-Policy"), path)
        assertEquals(SecurityHeadersConfig.PERMISSIONS_POLICY, response.getHeader("Permissions-Policy"), path)
        assertNull(response.getHeader(HttpHeaders.SET_COOKIE), path)
        assertNull(response.getHeader(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN), path)
    }

    private fun escape(text: String) = text.replace("&", "&amp;").replace("'", "&#39;").replace("\"", "&quot;")

    private fun unescape(text: String) =
        text
            .replace("&#39;", "'")
            .replace("&quot;", "\"")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&amp;", "&")

    companion object {
        private val counter = AtomicInteger()
        const val CSS_BUDGET = 14 * 1024
        const val FONT_BUDGET = 100 * 1024

        /** Every request from its own address, so the per-address bucket of one test never touches another. */
        fun nextIp(): String {
            val n = counter.incrementAndGet()
            return "10.251.${(n / 250) % 250}.${1 + n % 250}"
        }
    }
}
