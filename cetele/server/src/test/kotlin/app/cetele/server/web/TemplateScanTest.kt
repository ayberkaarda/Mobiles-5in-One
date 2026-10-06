package app.cetele.server.web

import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TemplateScanTest {
    @Test
    fun `templates prohibit unescaped output and executable inline content`() {
        val root = Path.of("src/main/resources/templates")
        Files.walk(root).use { paths ->
            val templates = paths.filter { Files.isRegularFile(it) && it.toString().endsWith(".html") }.toList()
            assertTrue(templates.isNotEmpty())
            templates.forEach { path ->
                val text = Files.readString(path)
                listOf(
                    Regex("th:utext", RegexOption.IGNORE_CASE),
                    Regex("th:inline\\s*=\\s*['\"]javascript", RegexOption.IGNORE_CASE),
                    Regex("<script\\b", RegexOption.IGNORE_CASE),
                    Regex("\\bstyle\\s*=", RegexOption.IGNORE_CASE),
                ).forEach { forbidden ->
                    assertFalse(forbidden.containsMatchIn(text), "$path contains forbidden template content")
                }
            }
        }
    }
}
