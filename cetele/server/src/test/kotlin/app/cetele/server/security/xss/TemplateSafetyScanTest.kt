package app.cetele.server.security.xss

import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.extension
import kotlin.io.path.invariantSeparatorsPathString
import kotlin.io.path.name
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Static half of item 16: every Thymeleaf template and every server source that can produce
 * markup. The rules are wider than the baseline `TemplateScanTest`: unescaped inlining `[(...)]`,
 * preprocessing `__...__`, handler attributes in any spelling, script URLs, and URL attributes fed
 * from anything but a link expression or a reviewed, server-built model value.
 */
class TemplateSafetyScanTest {
    private val templates: Map<Path, String> by lazy {
        Files.walk(TEMPLATES).use { paths ->
            paths.filter { Files.isRegularFile(it) && it.extension == "html" }.toList().associateWith { Files.readString(it) }
        }
    }

    @Test
    fun `templates contain no unescaped output, inline script mode or inline handler`() {
        assertTrue(templates.size >= 18, "templates found: ${templates.size}")
        val forbidden =
            mapOf(
                "th:utext" to Regex("""\b(th:|data-th-)utext\b""", RegexOption.IGNORE_CASE),
                "th:inline other than none" to Regex("""\b(th:|data-th-)inline\s*=\s*["'](?!none["'])""", RegexOption.IGNORE_CASE),
                "unescaped inlined expression" to Regex("""\[\("""),
                "preprocessed expression" to Regex("""__\$\{|__\*\{|__#\{"""),
                "inline event handler" to Regex("""\s(th:|data-th-)?on[a-z]+\s*=""", RegexOption.IGNORE_CASE),
                "handler set through th:attr" to Regex("""th:attr\s*=\s*["'][^"']*\bon[a-z]+\s*=""", RegexOption.IGNORE_CASE),
                "script element" to Regex("""<script\b""", RegexOption.IGNORE_CASE),
                "script URL" to Regex("""(javascript|vbscript)\s*:""", RegexOption.IGNORE_CASE),
                "style attribute" to Regex("""\sstyle\s*=""", RegexOption.IGNORE_CASE),
                "style element" to Regex("""<style\b""", RegexOption.IGNORE_CASE),
                "frame or object" to Regex("""<(iframe|frame|object|embed|base)\b""", RegexOption.IGNORE_CASE),
            )
        val findings =
            templates.flatMap { (path, text) ->
                forbidden.filter { (_, pattern) -> pattern.containsMatchIn(text) }.map { (label, _) -> "${relative(path)}: $label" }
            }
        assertEquals(emptyList(), findings)
    }

    @Test
    fun `the safe markup attribute is used once, on the site page, for rendered Markdown`() {
        val uses =
            templates.flatMap { (path, text) ->
                Regex(
                    """site:(html|jsonld)\s*=\s*"([^"]*)"""",
                ).findAll(text).map { "${relative(path)} ${it.groupValues[1]}=${it.groupValues[2]}" }
            }
        assertEquals(listOf("site/page.html html=\${page.html}", "site/page.html jsonld=\${page.jsonLd}").sorted(), uses.sorted())
    }

    @Test
    fun `url attributes take link expressions or reviewed server-built values only`() {
        val reviewed = setOf("\${card.path}", "\${crumb.path}", "\${link.path}", "\${page.canonical}", "\${enrollment.qrDataUri}")
        val findings =
            templates.flatMap { (path, text) ->
                Regex("""(?:th|data-th):(href|src|action|formaction|attr|attrappend|attrprepend)\s*=\s*"([^"]*)"""")
                    .findAll(text)
                    .mapNotNull { match ->
                        val (attribute, expression) = match.destructured
                        val ok =
                            when (attribute) {
                                "attr", "attrappend", "attrprepend" -> {
                                    !Regex(
                                        """\b(href|src|action|formaction|on[a-z]+)\s*=""",
                                        RegexOption.IGNORE_CASE,
                                    ).containsMatchIn(expression)
                                }

                                else -> {
                                    expression.startsWith("@{") || expression in reviewed
                                }
                            }
                        if (ok) null else "${relative(path)}: th:$attribute=\"$expression\""
                    }.toList()
            }
        assertEquals(emptyList(), findings)
    }

    @Test
    fun `server sources build html only through templates and the escaping Markdown renderer`() {
        val sources =
            Files.walk(SOURCES).use { paths -> paths.filter { Files.isRegularFile(it) && it.extension == "kt" }.toList() }
        assertTrue(sources.isNotEmpty())
        val findings = mutableListOf<String>()
        sources.forEach { path ->
            val text = Files.readString(path)
            val name = path.name
            if (name != "MarkdownRenderer.kt" && name != "SafeMarkup.kt" && Regex("""\bSafeHtml\(""").containsMatchIn(text)) {
                findings += "${relative(path)}: creates SafeHtml"
            }
            if (name != "SafeMarkup.kt" && name != "StructuredData.kt" && Regex("""\bJsonLd\(""").containsMatchIn(text)) {
                findings += "${relative(path)}: creates JsonLd"
            }
            if (Regex("""escapeHtml\(\s*false""").containsMatchIn(text)) findings += "${relative(path)}: escapeHtml(false)"
            if (name != "MarkdownRenderer.kt" && text.contains("HtmlRenderer")) findings += "${relative(path)}: second Markdown renderer"
            if (Regex("""setBody\([^)]*,\s*false\)""").containsMatchIn(text) && name != "SiteDialect.kt") {
                findings += "${relative(path)}: unescaped Thymeleaf body"
            }
            if (Regex(""""<(html|body|div|p|script)\b""", RegexOption.IGNORE_CASE).containsMatchIn(text)) {
                findings += "${relative(path)}: markup built in a string literal"
            }
        }
        assertEquals(emptyList(), findings)
        val renderer = Files.readString(SOURCES.resolve("web/site/content/MarkdownRenderer.kt"))
        assertTrue(renderer.contains(".escapeHtml(true)"), "MarkdownRenderer escapes raw HTML")
    }

    private fun relative(path: Path): String =
        (if (path.startsWith(TEMPLATES)) TEMPLATES.relativize(path) else SOURCES.relativize(path)).invariantSeparatorsPathString

    private companion object {
        val TEMPLATES: Path = Path.of("src/main/resources/templates")
        val SOURCES: Path = Path.of("src/main/kotlin/app/cetele/server")
    }
}
