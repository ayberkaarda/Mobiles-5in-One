package app.cetele.server.web.site.content

import app.cetele.server.web.site.SafeHtml
import java.time.LocalDate

/** One question and its answer from the `faq:` list of `pages/sss.md`. */
data class FaqItem(
    val question: String,
    val answer: String,
)

/**
 * A parsed content file: the front matter keys of the content specification, the Markdown body
 * as written (for `llms-full.txt`) and the same body rendered to escaped HTML.
 */
data class ContentPage(
    val file: String,
    val slug: String,
    val title: String,
    val description: String,
    val updated: LocalDate,
    val lead: String,
    val keywords: List<String>,
    val breadcrumb: String,
    val faq: List<FaqItem>,
    val markdown: String,
    val html: SafeHtml,
)
