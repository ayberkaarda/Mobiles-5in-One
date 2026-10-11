package app.cetele.server.web.site

/**
 * HTML that may be written without escaping. Only [app.cetele.server.web.site.content.MarkdownRenderer]
 * (CommonMark with raw HTML escaped and unsafe URLs removed) creates it; templates print it with
 * `site:html`, which refuses every other type.
 */
class SafeHtml internal constructor(
    val value: String,
) {
    override fun equals(other: Any?): Boolean = other is SafeHtml && other.value == value

    override fun hashCode(): Int = value.hashCode()

    override fun toString(): String = value
}

/**
 * A JSON-LD document serialised by [app.cetele.server.web.site.seo.StructuredData], with `<`, `>`,
 * `&` and the two JavaScript line separators written as `\u` escapes, so the text can never close
 * its `<script type="application/ld+json">` element. Printed with `site:jsonld`.
 */
class JsonLd internal constructor(
    val value: String,
) {
    override fun toString(): String = value

    companion object {
        /** Escapes the characters that matter inside a script data block; valid JSON stays valid JSON. */
        fun escapeForScript(json: String): String =
            buildString(json.length + 16) {
                json.forEach { char ->
                    when (char) {
                        '<' -> append("\\u003c")
                        '>' -> append("\\u003e")
                        '&' -> append("\\u0026")
                        ' ' -> append("\\u2028")
                        ' ' -> append("\\u2029")
                        else -> append(char)
                    }
                }
            }
    }
}
