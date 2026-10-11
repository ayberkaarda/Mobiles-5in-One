package app.cetele.server.web.site.seo

import app.cetele.server.web.site.PageKind
import app.cetele.server.web.site.SiteFacts
import app.cetele.server.web.site.SitePages
import app.cetele.server.web.site.SiteProperties
import app.cetele.server.web.site.SiteRoute
import app.cetele.server.web.site.SiteRoutes
import app.cetele.server.web.site.content.SiteContent
import org.springframework.stereotype.Component
import tools.jackson.databind.json.JsonMapper

/**
 * The machine-readable files of the site, all built from [SiteRoutes] and the loaded content.
 * Content and configuration are fixed after startup, so each file is rendered once.
 */
@Component
class SiteFiles(
    private val properties: SiteProperties,
    private val content: SiteContent,
) {
    private val mapper = JsonMapper.builder().build()

    private fun url(path: String) = properties.baseUrl + path

    /** `sitemap.xml`: one `<url>` per registry route, `lastmod` from the content's `updated`. */
    val sitemap: String by lazy {
        buildString {
            append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
            append("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n")
            SiteRoutes.all.forEach { route ->
                append("  <url><loc>").append(xml(url(route.path))).append("</loc>")
                append("<lastmod>").append(content.lastModified(route)).append("</lastmod></url>\n")
            }
            append("</urlset>\n")
        }
    }

    /** `robots.txt`: everything public except the console, the statement links and the API. */
    val robots: String by lazy {
        buildString {
            append("User-agent: *\n")
            append("Allow: /\n")
            SiteRoutes.disallowed.forEach { append("Disallow: ").append(it).append('\n') }
            append('\n')
            append("Sitemap: ").append(url(SiteRoutes.SITEMAP)).append('\n')
        }
    }

    /** `llms.txt` (llmstxt.org layout): definition, audience, features, plans and the page index. */
    val llms: String by lazy { header() + index() }

    /** `llms-full.txt`: the same header followed by every page in Markdown, links made absolute. */
    val llmsFull: String by lazy {
        buildString {
            append(header())
            SiteRoutes.all.forEach { route -> append(fullPage(route)) }
        }
    }

    /**
     * `assetlinks.json` for [SiteFacts.APPLICATION_ID], or `null` when no signing fingerprint is
     * configured. The dynamic app link components limit verified links to [APP_LINK_PATHS]
     * (Android 15 and later; older versions use the app's intent filter paths).
     */
    val assetLinks: String? by lazy {
        val fingerprints = properties.fingerprints
        if (fingerprints.isEmpty()) {
            null
        } else {
            val relation = "delegate_permission/common.handle_all_urls"
            val statement =
                linkedMapOf(
                    "relation" to listOf(relation),
                    "relation_extensions" to
                        mapOf(
                            relation to
                                mapOf(
                                    "dynamic_app_link_components" to
                                        APP_LINK_PATHS.map { mapOf("/" to it) } +
                                        listOf(linkedMapOf("/" to "*", "exclude" to true)),
                                ),
                        ),
                    "target" to
                        linkedMapOf(
                            "namespace" to "android_app",
                            "package_name" to SiteFacts.APPLICATION_ID,
                            "sha256_cert_fingerprints" to fingerprints,
                        ),
                )
            mapper.writeValueAsString(listOf(statement)) + "\n"
        }
    }

    private fun header(): String {
        val home = content.of(SiteRoutes.HOME)
        return buildString {
            append("# ").append(SiteFacts.NAME).append("\n\n")
            append("> ").append(home.lead).append("\n\n")
            append("- Uygulama: ")
                .append(SiteFacts.APP_NAME)
                .append(" (Android, ")
                .append(SiteFacts.APPLICATION_ID)
                .append(")\n")
            append("- Dil: Türkçe; para birimi: Türk lirası (").append(SiteFacts.CURRENCY).append(")\n")
            append("- Durum: ").append(SiteFacts.STATUS).append("\n\n")
            append("## Kimler için\n\n").append(SiteFacts.AUDIENCE).append("\n\n")
            append("## Özellikler\n\n")
            SiteFacts.FEATURES.forEach { append("- ").append(it).append('\n') }
            append("\n## Planlar\n\n")
            append("- ").append(SiteFacts.freeSummary()).append('\n')
            append("- ").append(SiteFacts.proSummary()).append("\n\n")
        }
    }

    private fun index(): String =
        buildString {
            section("Sayfalar", SiteRoutes.all.filter { it.kind in setOf(PageKind.HOME, PageKind.PAGE, PageKind.FAQ) })
            section("Esnaf için", SiteRoutes.trades)
            section("Rehber", listOf(SiteRoutes.get(SiteRoutes.GUIDES)) + SiteRoutes.guides)
            section("Yasal metinler (örnek metinler)", SiteRoutes.legal)
        }

    private fun StringBuilder.section(
        name: String,
        routes: List<SiteRoute>,
    ) {
        append("## ").append(name).append("\n\n")
        routes.forEach { route ->
            append("- [")
                .append(SitePages.heading(title(route)))
                .append("](")
                .append(url(route.path))
                .append("): ")
            append(description(route)).append('\n')
        }
        append('\n')
    }

    private fun fullPage(route: SiteRoute): String =
        buildString {
            append("---\n\n")
            append("# ").append(SitePages.heading(title(route))).append("\n\n")
            append("URL: ").append(url(route.path)).append('\n')
            append("Güncelleme: ").append(content.lastModified(route)).append("\n\n")
            if (route.content == null) {
                append(SiteRoutes.GUIDE_INDEX_META.lead).append("\n\n")
                SiteRoutes.guides.forEach { guide ->
                    append("- [")
                        .append(SitePages.heading(title(guide)))
                        .append("](")
                        .append(url(guide.path))
                        .append(")\n")
                }
                append('\n')
                return@buildString
            }
            val page = content.of(route)
            append(page.lead).append("\n\n")
            append(absoluteLinks(page.markdown)).append("\n\n")
            if (page.faq.isNotEmpty()) {
                page.faq.forEach { item ->
                    append("### ")
                        .append(item.question)
                        .append("\n\n")
                        .append(item.answer)
                        .append("\n\n")
                }
            }
        }

    private fun title(route: SiteRoute) = route.content?.let { content.of(route).title } ?: SiteRoutes.GUIDE_INDEX_META.title

    private fun description(route: SiteRoute) =
        route.content?.let { content.of(route).description } ?: SiteRoutes.GUIDE_INDEX_META.description

    private fun absoluteLinks(markdown: String): String =
        INTERNAL_LINK.replace(markdown) { match -> "](" + url(match.groupValues[1]) + ")" }

    companion object {
        val APP_LINK_PATHS = listOf("/s/*", "/invite/*")
        private val INTERNAL_LINK = Regex("""\]\((/[^)\s]*)\)""")

        fun xml(text: String): String =
            text
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&apos;")
    }
}
