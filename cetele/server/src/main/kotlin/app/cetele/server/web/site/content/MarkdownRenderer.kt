package app.cetele.server.web.site.content

import app.cetele.server.web.site.SafeHtml
import org.commonmark.ext.gfm.tables.TablesExtension
import org.commonmark.node.AbstractVisitor
import org.commonmark.node.Heading
import org.commonmark.node.Image
import org.commonmark.node.Link
import org.commonmark.node.Node
import org.commonmark.parser.Parser
import org.commonmark.renderer.html.HtmlRenderer

/**
 * CommonMark with GFM tables. Raw HTML in the source is escaped; a link or image target that is
 * not a site path, an anchor, `https:`, `http:` or `mailto:` is emptied (so `javascript:` and
 * `data:` never reach a page); headings are moved below the page's single `h1` (the title): a `#`
 * heading becomes `h2`, everything stays within `h2`..`h6`. CommonMark's own URL sanitiser is not
 * used because it marks every link `nofollow`, internal links included.
 */
object MarkdownRenderer {
    private val extensions = listOf(TablesExtension.create())
    private val parser: Parser = Parser.builder().extensions(extensions).build()
    private val renderer: HtmlRenderer =
        HtmlRenderer
            .builder()
            .extensions(extensions)
            .escapeHtml(true)
            .build()

    fun render(markdown: String): SafeHtml {
        val document: Node = parser.parse(markdown)
        document.accept(
            object : AbstractVisitor() {
                override fun visit(heading: Heading) {
                    heading.level = heading.level.coerceIn(MIN_LEVEL, MAX_LEVEL)
                    visitChildren(heading)
                }

                override fun visit(link: Link) {
                    if (!isSafe(link.destination)) link.destination = ""
                    visitChildren(link)
                }

                override fun visit(image: Image) {
                    if (!isSafe(image.destination)) image.destination = ""
                    visitChildren(image)
                }
            },
        )
        return SafeHtml(renderer.render(document))
    }

    /** Site paths, anchors and the web and mail schemes; everything else, relative or not, is refused. */
    fun isSafe(destination: String): Boolean {
        val target = destination.trim()
        if (target.startsWith("//")) return false
        if (target.startsWith("/") || target.startsWith("#")) return true
        val scheme = target.substringBefore(':', missingDelimiterValue = "").lowercase()
        return scheme in SAFE_SCHEMES
    }

    private val SAFE_SCHEMES = setOf("https", "http", "mailto")
    private const val MIN_LEVEL = 2
    private const val MAX_LEVEL = 6
}
