package app.cetele.server.web.site

/** What a route renders; decides the template parts and the structured data of the page. */
enum class PageKind {
    HOME,
    PAGE,
    FAQ,
    TRADE,
    GUIDE_INDEX,
    GUIDE,
    LEGAL,
}

/** The folders under the content location. */
enum class ContentKind(
    val folder: String,
) {
    PAGES("pages"),
    TRADES("trades"),
    GUIDES("guides"),
    LEGAL("legal"),
}

/**
 * One public page. [content] names the Markdown file that feeds it (`<folder>/<slug>.md`);
 * only the guide index has none and takes its texts from [SiteRoutes.GUIDE_INDEX_META].
 */
data class SiteRoute(
    val path: String,
    val kind: PageKind,
    val label: String,
    val content: ContentRef?,
    val parent: String? = null,
)

data class ContentRef(
    val kind: ContentKind,
    val slug: String,
) {
    val file: String get() = "${kind.folder}/$slug.md"
}

/** Fixed texts of the one page without a content file. */
data class FixedMeta(
    val title: String,
    val description: String,
    val lead: String,
)

/**
 * The single list of public pages (spec section 7). Controllers, the sitemap, `llms.txt`,
 * `llms-full.txt`, the navigation and the startup content check all read it; a page that is not
 * here does not exist.
 */
object SiteRoutes {
    const val HOME = "/"
    const val GUIDES = "/rehber"
    const val TRADES_PREFIX = "/esnaf-icin/"
    const val GUIDES_PREFIX = "/rehber/"

    val TRADE_SLUGS = listOf("bakkal", "manav", "kasap", "berber")

    val GUIDE_SLUGS =
        listOf(
            "veresiye-defteri-nasil-tutulur",
            "alacak-takibi-icin-7-kural",
            "musteriye-borc-hatirlatma-mesaji-ornekleri",
            "kvkk-musteri-telefonunu-saklamak",
            "bakkal-icin-dijital-defter",
        )

    private val TRADE_LABELS = mapOf("bakkal" to "Bakkal", "manav" to "Manav", "kasap" to "Kasap", "berber" to "Berber")

    val GUIDE_INDEX_META =
        FixedMeta(
            title = "Veresiye ve Alacak Takibi Rehberi | Çetele",
            description =
                "Veresiye defteri tutma, alacak takibi, borç hatırlatma mesajları ve müşteri telefonunu saklama " +
                    "üzerine esnafa yönelik pratik rehberler.",
            lead =
                "Bu rehberler, veresiye defterini düzenli tutmak, alacakları zamanında takip etmek ve müşteriye " +
                    "kırmadan hatırlatma yapmak isteyen bakkal, manav, kasap ve berberler için yazıldı. Her yazı " +
                    "kısa bir cevapla başlar, ardından adım adım uygulanabilir öneriler verir.",
        )

    val all: List<SiteRoute> =
        buildList {
            add(SiteRoute(HOME, PageKind.HOME, "Ana sayfa", ContentRef(ContentKind.PAGES, "home")))
            add(SiteRoute("/ozellikler", PageKind.PAGE, "Özellikler", ContentRef(ContentKind.PAGES, "ozellikler")))
            add(SiteRoute("/fiyatlandirma", PageKind.PAGE, "Fiyatlandırma", ContentRef(ContentKind.PAGES, "fiyatlandirma")))
            TRADE_SLUGS.forEach { slug ->
                add(
                    SiteRoute(
                        TRADES_PREFIX + slug,
                        PageKind.TRADE,
                        TRADE_LABELS.getValue(slug) + " için",
                        ContentRef(ContentKind.TRADES, slug),
                    ),
                )
            }
            add(SiteRoute(GUIDES, PageKind.GUIDE_INDEX, "Rehber", null))
            GUIDE_SLUGS.forEach { slug ->
                add(SiteRoute(GUIDES_PREFIX + slug, PageKind.GUIDE, "Rehber yazısı", ContentRef(ContentKind.GUIDES, slug), parent = GUIDES))
            }
            add(SiteRoute("/sss", PageKind.FAQ, "Sık sorulan sorular", ContentRef(ContentKind.PAGES, "sss")))
            add(SiteRoute("/hakkinda", PageKind.PAGE, "Hakkında", ContentRef(ContentKind.PAGES, "hakkinda")))
            add(SiteRoute("/gizlilik", PageKind.LEGAL, "Gizlilik", ContentRef(ContentKind.LEGAL, "gizlilik")))
            add(SiteRoute("/kvkk-aydinlatma", PageKind.LEGAL, "KVKK aydınlatma", ContentRef(ContentKind.LEGAL, "kvkk-aydinlatma")))
            add(SiteRoute("/hesap-silme", PageKind.LEGAL, "Hesap silme", ContentRef(ContentKind.LEGAL, "hesap-silme")))
            add(SiteRoute("/iletisim", PageKind.PAGE, "İletişim", ContentRef(ContentKind.PAGES, "iletisim")))
        }

    private val byPath: Map<String, SiteRoute> = all.associateBy { it.path }

    fun find(path: String): SiteRoute? = byPath[path]

    fun get(path: String): SiteRoute = byPath.getValue(path)

    val trades: List<SiteRoute> get() = all.filter { it.kind == PageKind.TRADE }

    val guides: List<SiteRoute> get() = all.filter { it.kind == PageKind.GUIDE }

    val legal: List<SiteRoute> get() = all.filter { it.kind == PageKind.LEGAL }

    /** The machine-readable files served next to the pages; they are not pages and not in the sitemap. */
    const val SITEMAP = "/sitemap.xml"
    const val ROBOTS = "/robots.txt"
    const val LLMS = "/llms.txt"
    const val LLMS_FULL = "/llms-full.txt"
    const val ASSET_LINKS = "/.well-known/assetlinks.json"
    const val ASSETS = "/assets/site/**"

    /** Every path the public site chain answers: the pages, the two slug families, the files and the assets. */
    val chainPatterns: List<String> =
        all.map { it.path }.filterNot { it.startsWith(TRADES_PREFIX) || it.startsWith(GUIDES_PREFIX) } +
            listOf(TRADES_PREFIX + "*", GUIDES_PREFIX + "*", SITEMAP, ROBOTS, LLMS, LLMS_FULL, ASSET_LINKS, ASSETS)

    /** Paths that robots.txt keeps crawlers away from: the console, the private statements and the API. */
    val disallowed = listOf("/admin", "/s/", "/v1/")
}
