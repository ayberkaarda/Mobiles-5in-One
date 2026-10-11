package app.cetele.server.security.xss

import app.cetele.server.web.site.content.MarkdownRenderer
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The content renderer of the public site: raw HTML is text, script and data URLs never reach a link. */
class MarkdownEscapeTest {
    private val allowedTags =
        setOf(
            "p",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "a",
            "img",
            "em",
            "strong",
            "code",
            "pre",
            "ul",
            "ol",
            "li",
            "blockquote",
            "hr",
            "br",
            "table",
            "thead",
            "tbody",
            "tr",
            "th",
            "td",
        )

    private fun render(markdown: String): String = MarkdownRenderer.render(markdown).value

    private fun assertSafe(
        html: String,
        where: String,
    ) {
        HtmlInspector.assertInert(html, where, fragment = true)
        HtmlInspector.tags(html).forEach { tag ->
            assertTrue(tag.name.removePrefix("/") in allowedTags, "$where: unexpected element <${tag.name}>")
            tag.attributes.forEach { (name, value) ->
                assertTrue(name in setOf("href", "src", "alt", "title", "align"), "$where: unexpected attribute $name")
                if (name == "href" || name == "src") {
                    val ok =
                        value.isEmpty() ||
                            (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")) ||
                            value.startsWith("#") ||
                            listOf("https:", "http:", "mailto:").any { value.lowercase().startsWith(it) }
                    assertTrue(ok, "$where: $name=$value")
                }
            }
        }
    }

    @Test
    fun `every corpus payload renders as escaped text in a paragraph, a heading, a list and a table`() {
        XssCorpus.all.forEach { payload ->
            val inline = payload.replace("|", "\\|")
            listOf(
                payload,
                "Metin $payload metin",
                "# $payload",
                "- $payload",
                "| a | b |\n|---|---|\n| $inline | x |",
                "> $payload",
            ).forEach { markdown ->
                val html = render(markdown)
                assertSafe(html, "markdown [$markdown]")
            }
            val paragraph = render(payload)
            // Markdown syntax characters change the text on purpose (emphasis, escapes, entities).
            if (!payload.startsWith("<") && payload.none { it in "*_`\\&" }) {
                HtmlInspector.assertShowsText(paragraph, payload, "markdown paragraph")
            }
        }
    }

    @Test
    fun `raw html blocks and inline html are escaped, not passed through`() {
        val cases =
            mapOf(
                "<script>alert(1)</script>" to "<script>alert(1)</script>",
                "<div onclick=\"alert(1)\">x</div>" to "<div onclick=\"alert(1)\">x</div>",
                "a <img src=x onerror=alert(1)> b" to "<img src=x onerror=alert(1)>",
                "<svg onload=alert(1)>" to "<svg onload=alert(1)>",
                "<iframe src=\"javascript:alert(1)\"></iframe>" to "<iframe src=\"javascript:alert(1)\"></iframe>",
                "<!-- <script>alert(1)</script> -->" to "<!-- <script>alert(1)</script> -->",
                "<style>body{display:none}</style>" to "<style>body{display:none}</style>",
            )
        cases.forEach { (markdown, shown) ->
            val html = render(markdown)
            assertSafe(html, "raw html [$markdown]")
            HtmlInspector.assertShowsText(html, shown, "raw html [$markdown]")
            assertTrue(html.contains("&lt;"), "raw html [$markdown] is escaped: $html")
        }
    }

    @Test
    fun `script and data urls are removed from links, images, autolinks and reference definitions`() {
        val cases =
            listOf(
                "[x](javascript:alert(1))",
                "[x](JaVaScRiPt:alert(1))",
                "[x]( javascript:alert(1) )",
                "[x](&#106;avascript:alert(1))",
                "[x](javascript&colon;alert(1))",
                "[x](jav&#x09;ascript:alert(1))",
                "[x](<javascript:alert(1)>)",
                "[x](vbscript:msgbox(1))",
                "[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
                "[x](//example.invalid/a)",
                "[x](file:///etc/passwd)",
                "<javascript:alert(1)>",
                "[x][r]\n\n[r]: javascript:alert(1)",
                "![x](javascript:alert(1))",
                "![x](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)",
                "[x](/a \"\\\" onmouseover=\\\"alert(1)\")",
            )
        cases.forEach { markdown ->
            val html = render(markdown)
            assertSafe(html, "url [$markdown]")
            assertTrue(!html.lowercase().contains("href=\"javascript") && !html.lowercase().contains("src=\"javascript"), html)
        }
        val removed = listOf("javascript:", "vbscript:", "data:", "//example.invalid", "file:")
        cases.take(11).forEach { markdown ->
            val href = HtmlInspector.tags(render(markdown)).first { it.name == "a" }.attribute("href")
            assertEquals("", href, "url [$markdown] keeps no target")
            assertTrue(removed.none { href.orEmpty().lowercase().contains(it) })
        }
    }

    /**
     * Regression for the protocol-relative bypass: browsers read `/\host` and `/<tab>/host` as
     * `//host` (the URL parser treats a backslash as a slash and drops tabs and line breaks), so
     * these targets left the site although the renderer refuses `//`.
     */
    @Test
    fun `protocol-relative spellings with a backslash or a stripped character are refused`() {
        listOf(
            "[x](/\\example.invalid)",
            "[x](/\\\\example.invalid)",
            "[x](/&#9;/example.invalid)",
            "[x](/&#10;/example.invalid)",
            "[x](&#9;//example.invalid)",
            "![x](/\\example.invalid/a.png)",
        ).forEach { markdown ->
            val html = render(markdown)
            assertSafe(html, "url [$markdown]")
            val tag = HtmlInspector.tags(html).first { it.name == "a" || it.name == "img" }
            assertEquals("", tag.attribute("href") ?: tag.attribute("src"), "url [$markdown] keeps no target")
        }
        assertTrue(MarkdownRenderer.isSafe("/rehber/veresiye-defteri-nasil-tutulur"))
        assertTrue(!MarkdownRenderer.isSafe("/\\example.invalid"))
        assertTrue(!MarkdownRenderer.isSafe("/\t/example.invalid"))
    }

    @Test
    fun `site paths, anchors and web links keep their targets`() {
        mapOf(
            "[x](/rehber)" to "/rehber",
            "[x](#sorular)" to "#sorular",
            "[x](https://example.invalid/a?b=1&c=2)" to "https://example.invalid/a?b=1&c=2",
            "[x](mailto:destek@example.invalid)" to "mailto:destek@example.invalid",
        ).forEach { (markdown, target) ->
            val html = render(markdown)
            assertSafe(html, "url [$markdown]")
            assertEquals(target, HtmlInspector.tags(html).first { it.name == "a" }.attribute("href"))
        }
    }
}
