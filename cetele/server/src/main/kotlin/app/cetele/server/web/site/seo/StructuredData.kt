package app.cetele.server.web.site.seo

import app.cetele.server.web.site.Crumb
import app.cetele.server.web.site.JsonLd
import app.cetele.server.web.site.PageKind
import app.cetele.server.web.site.SiteFacts
import app.cetele.server.web.site.SiteProperties
import app.cetele.server.web.site.SiteRoute
import app.cetele.server.web.site.SiteRoutes
import app.cetele.server.web.site.content.ContentPage
import app.cetele.server.web.site.content.SiteContent
import org.springframework.stereotype.Component
import tools.jackson.databind.json.JsonMapper
import java.time.LocalDate

/**
 * The JSON-LD `@graph` of each page (schema.org). Every page carries `Organization` and `WebSite`;
 * product pages add `MobileApplication`; `/sss` is an `FAQPage` built from the `faq:` list; guides
 * are `Article`s whose dates are the file's `updated`; every page below the home page has a
 * `BreadcrumbList`. Offers state only what is true: the free plan at price 0. Pro has no fixed
 * price, so it is described in text and never given an `Offer`.
 */
@Component
class StructuredData(
    private val properties: SiteProperties,
    private val content: SiteContent,
) {
    private val mapper = JsonMapper.builder().build()

    fun forPage(
        route: SiteRoute,
        title: String,
        description: String,
        modified: LocalDate,
        page: ContentPage?,
        crumbs: List<Crumb>,
    ): JsonLd {
        val canonical = url(route.path)
        val graph = mutableListOf(organization(), website())
        if (withApplication(route)) graph += application()
        graph += webPage(route, canonical, title, description, modified, page, crumbs.isNotEmpty())
        if (route.kind == PageKind.GUIDE && page != null) graph += article(canonical, title, description, page)
        if (crumbs.isNotEmpty()) graph += breadcrumbs(canonical, crumbs)
        val document = linkedMapOf("@context" to "https://schema.org", "@graph" to graph)
        return JsonLd(JsonLd.escapeForScript(mapper.writeValueAsString(document)))
    }

    private fun url(path: String) = properties.baseUrl + path

    private fun ref(id: String) = mapOf("@id" to id)

    private val organizationId get() = url("/#organization")
    private val websiteId get() = url("/#website")
    private val applicationId get() = url("/#app")

    private fun organization(): Map<String, Any> =
        linkedMapOf(
            "@type" to "Organization",
            "@id" to organizationId,
            "name" to SiteFacts.NAME,
            "url" to url("/"),
            "logo" to
                linkedMapOf(
                    "@type" to "ImageObject",
                    "url" to url(SiteFacts.LOGO),
                    "width" to SiteFacts.LOGO_SIZE,
                    "height" to SiteFacts.LOGO_SIZE,
                ),
            "slogan" to SiteFacts.TAGLINE,
            "description" to SiteFacts.STATUS,
        )

    private fun website(): Map<String, Any> =
        linkedMapOf(
            "@type" to "WebSite",
            "@id" to websiteId,
            "url" to url("/"),
            "name" to SiteFacts.NAME,
            "inLanguage" to SiteFacts.LANGUAGE,
            "publisher" to ref(organizationId),
        )

    private fun application(): Map<String, Any> =
        linkedMapOf(
            "@type" to "MobileApplication",
            "@id" to applicationId,
            "name" to SiteFacts.APP_NAME,
            "operatingSystem" to "Android",
            "applicationCategory" to "BusinessApplication",
            "inLanguage" to SiteFacts.LANGUAGE,
            "url" to url("/"),
            "description" to content.of(SiteRoutes.HOME).lead + " " + SiteFacts.proSummary(),
            "featureList" to SiteFacts.FEATURES,
            "publisher" to ref(organizationId),
            "offers" to
                linkedMapOf(
                    "@type" to "Offer",
                    "name" to "Free",
                    "price" to "0",
                    "priceCurrency" to SiteFacts.CURRENCY,
                    "description" to SiteFacts.freeSummary(),
                ),
        )

    private fun webPage(
        route: SiteRoute,
        canonical: String,
        title: String,
        description: String,
        modified: LocalDate,
        page: ContentPage?,
        withBreadcrumb: Boolean,
    ): Map<String, Any> {
        val node =
            linkedMapOf<String, Any>(
                "@type" to pageType(route.kind),
                "@id" to "$canonical#webpage",
                "url" to canonical,
                "name" to title,
                "description" to description,
                "inLanguage" to SiteFacts.LANGUAGE,
                "isPartOf" to ref(websiteId),
                "dateModified" to modified.toString(),
            )
        if (withBreadcrumb) node["breadcrumb"] = ref("$canonical#breadcrumb")
        if (withApplication(route)) node["about"] = ref(applicationId)
        if (route.kind == PageKind.FAQ && page != null) {
            node["mainEntity"] =
                page.faq.map { item ->
                    linkedMapOf(
                        "@type" to "Question",
                        "name" to item.question,
                        "acceptedAnswer" to linkedMapOf("@type" to "Answer", "text" to item.answer),
                    )
                }
        }
        return node
    }

    private fun article(
        canonical: String,
        title: String,
        description: String,
        page: ContentPage,
    ): Map<String, Any> =
        linkedMapOf(
            "@type" to "Article",
            "@id" to "$canonical#article",
            "headline" to title,
            "description" to description,
            "inLanguage" to SiteFacts.LANGUAGE,
            "datePublished" to page.updated.toString(),
            "dateModified" to page.updated.toString(),
            "author" to ref(organizationId),
            "publisher" to ref(organizationId),
            "mainEntityOfPage" to ref("$canonical#webpage"),
            "image" to url(SiteFacts.OG_IMAGE),
            "keywords" to page.keywords,
        )

    private fun breadcrumbs(
        canonical: String,
        crumbs: List<Crumb>,
    ): Map<String, Any> =
        linkedMapOf(
            "@type" to "BreadcrumbList",
            "@id" to "$canonical#breadcrumb",
            "itemListElement" to
                crumbs.mapIndexed { index, crumb ->
                    linkedMapOf(
                        "@type" to "ListItem",
                        "position" to index + 1,
                        "name" to crumb.label,
                        "item" to url(crumb.path),
                    )
                },
        )

    companion object {
        private val PRODUCT_PATHS = setOf("/ozellikler", "/fiyatlandirma")

        /** Pages about the app itself: the home page, the product pages and the trade landings. */
        fun withApplication(route: SiteRoute): Boolean =
            route.kind == PageKind.HOME || route.kind == PageKind.TRADE || route.path in PRODUCT_PATHS

        fun pageType(kind: PageKind): String =
            when (kind) {
                PageKind.FAQ -> "FAQPage"
                PageKind.GUIDE_INDEX -> "CollectionPage"
                else -> "WebPage"
            }
    }
}
