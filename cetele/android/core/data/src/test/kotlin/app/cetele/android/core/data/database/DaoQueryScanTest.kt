package app.cetele.android.core.data.database

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.nio.file.Path

/** Item 15 evidence: every Room query binds its values and every tenant query is bound by `:shopId`. */
class DaoQueryScanTest {
    private val annotation = Regex("@Query\\(")
    private val rawArgument = Regex("\\A@Query\\(\\s*\"\"\"(.*?)\"\"\"\\s*,?\\s*\\)", RegexOption.DOT_MATCHES_ALL)
    private val plainArgument = Regex("\\A@Query\\(\\s*\"((?:\\\\.|[^\"\\\\])*)\"\\s*,?\\s*\\)")
    private val tenants =
        Regex("\\b(customers|ledger_entries|outbox_operations|pending_photos|sync_cursor|reminder_log)\\b")

    @Test fun everyTenantQueryUsesBoundValues() {
        val root =
            sequenceOf(
                Path.of("src/main"),
                Path.of("core/data/src/main"),
                Path.of("cetele/android/core/data/src/main"),
            ).first { Files.isDirectory(it) }
        var annotations = 0
        val queries =
            Files.walk(root).use { paths ->
                paths.filter { it.toString().endsWith(".kt") }.toList().flatMap { path ->
                    val source = Files.readString(path)
                    annotation
                        .findAll(source)
                        .map { match ->
                            annotations++
                            val rest = source.substring(match.range.first)
                            val parsed = rawArgument.find(rest) ?: plainArgument.find(rest)
                            requireNotNull(parsed) { "Unparsed @Query in $path" }
                                .groupValues[1]
                                .replace(Regex("\\s+"), " ")
                                .trim()
                        }.toList()
                }
            }
        assertEquals(annotations, queries.size)
        assertTrue(queries.size >= 30)
        for (query in queries) {
            assertFalse(query.contains('$'), query)
            if (tenants.containsMatchIn(query)) assertTrue(query.contains(":shopId"), query)
            if (query.contains("||")) {
                assertTrue(query.replace(Regex(":queryKey \\|\\| '%'"), "").contains("||").not(), query)
            }
        }
    }
}
