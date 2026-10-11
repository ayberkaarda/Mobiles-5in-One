package app.cetele.server.security.xss

import org.springframework.mock.web.MockHttpServletResponse
import org.unbescape.html.HtmlEscape
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * A small HTML tokenizer for rendered pages. Escaped text never contains a raw `<`, so every `<`
 * of a safe page starts markup the template wrote; [assertInert] proves that (each `<` opens a
 * well-formed tag) and then checks the tags and attributes against a deny list, which together
 * show that no stored value became an element, an attribute or a script URL.
 */
object HtmlInspector {
    data class Tag(
        val name: String,
        val attributes: List<Pair<String, String>>,
    ) {
        fun attribute(name: String): String? = attributes.firstOrNull { it.first == name }?.second
    }

    private val TAG =
        Regex(
            """<(!--[\s\S]*?--|[!?/]?[A-Za-z][^\s/>]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*/?>""",
        )
    private val ATTRIBUTE = Regex("""([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?""")

    private val FORBIDDEN_TAGS =
        setOf(
            "iframe",
            "frame",
            "frameset",
            "object",
            "embed",
            "applet",
            "math",
            "style",
            "base",
            "textarea",
            "xmp",
            "noscript",
            "template",
        )
    private val SVG_TAGS = setOf("svg", "path", "rect", "circle", "g", "use", "foreignobject", "animate", "set")
    private val URL_ATTRIBUTES = setOf("href", "src", "action", "formaction", "poster", "data", "background", "cite", "srcset")
    private val DANGEROUS_SCHEMES = listOf("javascript:", "vbscript:", "data:")

    fun tags(html: String): List<Tag> =
        TAG
            .findAll(html)
            .map { match ->
                val name = match.groupValues[1].lowercase()
                val attributes =
                    if (name.startsWith("!--")) {
                        emptyList()
                    } else {
                        ATTRIBUTE
                            .findAll(match.groupValues[2])
                            .map { a ->
                                val raw = a.groups[2]?.value ?: a.groups[3]?.value ?: a.groups[4]?.value ?: ""
                                a.groupValues[1].lowercase() to HtmlEscape.unescapeHtml(raw)
                            }.toList()
                    }
                Tag(name, attributes)
            }.toList()

    /** The markup skeleton: element names with their attribute names, in document order. */
    fun skeleton(html: String): List<String> = tags(html).map { tag -> tag.name + tag.attributes.joinToString("") { " " + it.first } }

    /** The decoded text of the page (tags replaced by line breaks). */
    fun text(html: String): String = HtmlEscape.unescapeHtml(TAG.replace(html, "\n"))

    /** Every attribute value, decoded. */
    fun attributeValues(html: String): List<String> = tags(html).flatMap { tag -> tag.attributes.map { it.second } }

    fun assertInert(
        html: String,
        where: String,
        allowSvg: Boolean = false,
        allowJsonLd: Boolean = false,
        allowDataImage: Boolean = false,
        fragment: Boolean = false,
    ) {
        val tags = tags(html)
        assertEquals(html.count { it == '<' }, tags.size, "$where: a '<' outside a well-formed template tag")
        assertFalse(html.contains(XssCorpus.EVAL_MARKER), "$where: a template expression was evaluated")
        if (!fragment) {
            assertEquals(1, tags.count { it.name == "body" }, "$where: one body element")
            assertTrue(tags.count { it.name == "title" } <= 1, "$where: at most one title element")
        }
        tags.forEach { tag ->
            val name = tag.name.removePrefix("/")
            if (name.startsWith("!--")) fail("$where: comment in the page")
            if (name in FORBIDDEN_TAGS) fail("$where: forbidden element <$name>")
            if (name in SVG_TAGS && !allowSvg) fail("$where: svg element <$name>")
            if (name == "script" && !(allowJsonLd && (tag.name == "/script" || tag.attribute("type") == "application/ld+json"))) {
                fail("$where: script element")
            }
            if (name == "meta" && tag.attribute("http-equiv") != null) fail("$where: meta http-equiv")
            tag.attributes.forEach { (attribute, value) ->
                if (attribute.startsWith("on")) fail("$where: event handler attribute $attribute")
                if (attribute in setOf("style", "srcdoc", "xlink:href", "autofocus")) fail("$where: attribute $attribute")
                if (attribute in URL_ATTRIBUTES) {
                    val target = value.filterNot { it.isWhitespace() || Character.isISOControl(it) }.lowercase()
                    val dataImage = allowDataImage && name == "img" && target.startsWith("data:image/png;base64,")
                    if (!dataImage && DANGEROUS_SCHEMES.any { target.startsWith(it) }) fail("$where: $attribute=$value")
                }
            }
        }
    }

    /** The page shows [value] as text (decoded text content, not markup). */
    fun assertShowsText(
        html: String,
        value: String,
        where: String,
    ) {
        assertTrue(text(html).contains(value), "$where: the stored value is not shown as text: $value")
    }

    /** Content-Security-Policy and nosniff of an HTML, JSON or PDF response. */
    fun assertHeaders(
        response: MockHttpServletResponse,
        where: String,
    ): Map<String, List<String>> {
        assertEquals("nosniff", response.getHeader("X-Content-Type-Options"), "$where: nosniff")
        val header = assertNotNull(response.getHeader("Content-Security-Policy"), "$where: Content-Security-Policy")
        val directives =
            header
                .split(';')
                .map { it.trim() }
                .filter { it.isNotEmpty() }
                .associate { directive ->
                    val parts = directive.split(Regex("\\s+"))
                    parts.first().lowercase() to parts.drop(1)
                }
        assertEquals(listOf("'none'"), directives["default-src"], "$where: default-src")
        val script = directives["script-src"] ?: directives.getValue("default-src")
        val banned =
            setOf("'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "'wasm-unsafe-eval'", "*", "data:", "blob:", "http:", "https:")
        script.forEach { source -> assertFalse(source.lowercase() in banned, "$where: script-src allows $source") }
        assertTrue(script == listOf("'none'") || script.any { it.startsWith("'nonce-") }, "$where: script-src is 'none' or nonce-bound")
        assertTrue(directives["object-src"] == null || directives["object-src"] == listOf("'none'"), "$where: object-src")
        assertEquals(listOf("'none'"), directives["frame-ancestors"], "$where: frame-ancestors")
        assertEquals(listOf("'self'"), directives["base-uri"], "$where: base-uri")
        assertEquals(listOf("'self'"), directives["form-action"], "$where: form-action")
        return directives
    }
}
