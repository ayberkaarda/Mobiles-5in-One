package app.cetele.server.web.site

import app.cetele.server.web.site.content.ContentPage
import app.cetele.server.web.site.content.FaqItem
import app.cetele.server.web.site.content.SiteContent
import app.cetele.server.web.site.seo.StructuredData
import org.springframework.stereotype.Component
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

data class Crumb(
    val label: String,
    val path: String,
)

data class LinkCard(
    val path: String,
    val title: String,
    val text: String,
)

data class NavLink(
    val path: String,
    val label: String,
)

/**
 * One of the app screenshots under `/assets/site/screens/`: emulator captures with sample data
 * (`docs/release/screenshots`), always printed with [caption], which says so.
 */
data class Screen(
    val src: String,
    val alt: String,
) {
    val caption: String get() = CAPTION

    companion object {
        const val CAPTION = "Emülatör görüntüsü, örnek verilerle"
        const val WIDTH = 540
        const val HEIGHT = 1200

        val LEDGER =
            Screen(
                "/assets/site/screens/musteri-hesabi.png",
                "Çetele'de bir müşterinin hesabı: güncel bakiye, borç ve tahsilat kayıtları, düzeltilen kayıt üstü çizili.",
            )
        val DASHBOARD =
            Screen(
                "/assets/site/screens/panel.png",
                "Çetele paneli: bugünün borç ve tahsilatı, toplam alacak ve en çok borçlu müşteriler.",
            )
        val CUSTOMERS =
            Screen(
                "/assets/site/screens/musteriler.png",
                "Çetele müşteri listesi: müşteriler ve güncel bakiyeleri, arama ve müşteri ekleme.",
            )
    }
}

/** Everything a site template prints for one page; the templates hold no logic beyond conditions and loops. */
data class SitePageView(
    val path: String,
    val kind: PageKind?,
    val title: String,
    val description: String,
    val heading: String,
    val lead: String,
    val canonical: String?,
    val robots: String,
    val ogType: String,
    val ogImage: String,
    val ogImageAlt: String,
    val modified: LocalDate?,
    val modifiedText: String?,
    val html: SafeHtml?,
    val faq: List<FaqItem>,
    val crumbs: List<Crumb>,
    val jsonLd: JsonLd?,
    val cards: List<LinkCard>,
    val trades: List<LinkCard>,
    val nav: List<NavLink>,
    val footerProduct: List<NavLink>,
    val footerTrades: List<NavLink>,
    val footerLegal: List<NavLink>,
    val screen: Screen? = null,
) {
    val home: Boolean get() = kind == PageKind.HOME
    val guide: Boolean get() = kind == PageKind.GUIDE

    /** The `body` class the stylesheet keys page layouts on: `page-home`, `page-faq`, `page-missing` for the 404. */
    val bodyClass: String get() = "page-" + (kind?.name?.lowercase()?.replace('_', '-') ?: "missing")

    /** The first sentence of the lead, set large; [leadMore] is the rest, both print the lead unchanged. */
    val leadIntro: String get() = splitLead(lead).first

    val leadMore: String? get() = splitLead(lead).second

    /** A heading with a colon is set on two lines: [headingKicker] keeps the colon, [headingMain] the rest. */
    val headingKicker: String? get() = heading.indexOf(": ").takeIf { it > 0 }?.let { heading.substring(0, it + 1) }

    val headingMain: String get() = headingKicker?.let { heading.substring(it.length + 1) } ?: heading

    companion object {
        private val SENTENCE_END = Regex("""(?<=[.!?]) (?=\p{Lu})""")

        fun splitLead(lead: String): Pair<String, String?> {
            val parts = lead.split(SENTENCE_END, limit = 2)
            return parts[0] to parts.getOrNull(1)
        }
    }
}

/** Builds the [SitePageView] of a route from the registry, the content and the configuration. */
@Component
class SitePages(
    private val content: SiteContent,
    private val properties: SiteProperties,
    private val structuredData: StructuredData,
) {
    fun url(path: String): String = properties.baseUrl + path

    fun view(route: SiteRoute): SitePageView {
        val page = route.content?.let { content.of(route) }
        val title = page?.title ?: SiteRoutes.GUIDE_INDEX_META.title
        val description = page?.description ?: SiteRoutes.GUIDE_INDEX_META.description
        val lead = page?.lead ?: SiteRoutes.GUIDE_INDEX_META.lead
        val modified = content.lastModified(route)
        val crumbs = crumbs(route, page)
        return SitePageView(
            path = route.path,
            kind = route.kind,
            title = title,
            description = description,
            heading = heading(title),
            lead = lead,
            canonical = url(route.path),
            robots = INDEX,
            ogType = if (route.kind == PageKind.GUIDE) "article" else "website",
            ogImage = url(SiteFacts.OG_IMAGE),
            ogImageAlt = SiteFacts.OG_IMAGE_ALT,
            modified = modified,
            modifiedText = DATE.format(modified),
            html = page?.html,
            faq = page?.faq.orEmpty(),
            crumbs = crumbs,
            jsonLd = structuredData.forPage(route, title, description, modified, page, crumbs),
            cards = cards(route),
            trades = if (route.kind == PageKind.HOME) tradeCards() else emptyList(),
            nav = NAV,
            footerProduct = FOOTER_PRODUCT,
            footerTrades = FOOTER_TRADES,
            footerLegal = FOOTER_LEGAL,
            screen = SCREENS[route.path] ?: if (route.kind == PageKind.TRADE) Screen.CUSTOMERS else null,
        )
    }

    /** The 404 page: no canonical, `noindex`, no structured data. */
    fun notFound(path: String): SitePageView =
        SitePageView(
            path = path,
            kind = null,
            title = "Sayfa bulunamadı | Çetele",
            description = "Aradığınız sayfa Çetele sitesinde bulunamadı.",
            heading = "Sayfa bulunamadı",
            lead = "Bu adreste bir sayfa yok. Aşağıdaki bağlantılardan ana sayfaya, rehbere veya sık sorulan sorulara dönebilirsiniz.",
            canonical = null,
            robots = NOINDEX,
            ogType = "website",
            ogImage = url(SiteFacts.OG_IMAGE),
            ogImageAlt = SiteFacts.OG_IMAGE_ALT,
            modified = null,
            modifiedText = null,
            html = null,
            faq = emptyList(),
            crumbs = emptyList(),
            jsonLd = null,
            cards = emptyList(),
            trades = emptyList(),
            nav = NAV,
            footerProduct = FOOTER_PRODUCT,
            footerTrades = FOOTER_TRADES,
            footerLegal = FOOTER_LEGAL,
        )

    private fun crumbs(
        route: SiteRoute,
        page: ContentPage?,
    ): List<Crumb> {
        if (route.kind == PageKind.HOME) return emptyList()
        val trail = mutableListOf(Crumb(SiteRoutes.get(SiteRoutes.HOME).label, SiteRoutes.HOME))
        route.parent?.let { trail += Crumb(SiteRoutes.get(it).label, it) }
        val label = if (route.kind == PageKind.GUIDE && page != null) heading(page.title) else route.label
        trail += Crumb(label, route.path)
        return trail
    }

    private fun cards(route: SiteRoute): List<LinkCard> =
        when (route.kind) {
            PageKind.HOME, PageKind.GUIDE_INDEX -> guideCards()
            PageKind.GUIDE, PageKind.TRADE -> guideCards().filterNot { it.path == route.path }
            else -> emptyList()
        }

    private fun guideCards(): List<LinkCard> =
        SiteRoutes.guides.map { route ->
            val page = content.of(route)
            LinkCard(route.path, heading(page.title), page.description)
        }

    private fun tradeCards(): List<LinkCard> =
        SiteRoutes.trades.map { route ->
            val page = content.of(route)
            LinkCard(route.path, route.label, page.description)
        }

    companion object {
        const val INDEX = "index, follow, max-image-preview:large"
        const val NOINDEX = "noindex, nofollow"
        private const val BRAND_SUFFIX = " | Çetele"
        private val DATE: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.forLanguageTag("tr-TR"))

        /** The visible `h1`: the title without the brand suffix, other ` | ` separators read as a colon. */
        fun heading(title: String): String = title.removeSuffix(BRAND_SUFFIX).replace(" | ", ": ")

        private fun link(path: String) = NavLink(path, SiteRoutes.get(path).label)

        val NAV: List<NavLink> =
            listOf(link("/ozellikler"), link("/fiyatlandirma"), link(SiteRoutes.GUIDES), link("/sss"))

        val FOOTER_PRODUCT: List<NavLink> =
            listOf(
                link(SiteRoutes.HOME),
                link("/ozellikler"),
                link("/fiyatlandirma"),
                link(SiteRoutes.GUIDES),
                link("/sss"),
                link("/hakkinda"),
                link("/iletisim"),
            )

        val FOOTER_TRADES: List<NavLink> = SiteRoutes.trades.map { NavLink(it.path, it.label) }

        val FOOTER_LEGAL: List<NavLink> = SiteRoutes.legal.map { NavLink(it.path, it.label) }

        /** Pages that show an app screenshot next to their lead; every trade page shows the customer list. */
        val SCREENS: Map<String, Screen> = mapOf(SiteRoutes.HOME to Screen.LEDGER, "/ozellikler" to Screen.DASHBOARD)
    }
}
