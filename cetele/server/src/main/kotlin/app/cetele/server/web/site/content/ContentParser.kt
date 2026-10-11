package app.cetele.server.web.site.content

import org.yaml.snakeyaml.LoaderOptions
import org.yaml.snakeyaml.Yaml
import org.yaml.snakeyaml.constructor.SafeConstructor
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeParseException
import java.util.Date

/** A content file that does not follow the content specification. */
class ContentException(
    message: String,
) : RuntimeException(message)

/**
 * Reads one content file: front matter between two `---` lines (a YAML subset: scalars, quoted
 * strings, lists and the `faq:` list of `q`/`a` maps) followed by the Markdown body. Only the
 * safe YAML constructor is used, so no type tag in a file can create an object.
 */
object ContentParser {
    const val TITLE_MAX = 60
    const val DESCRIPTION_MAX = 155

    fun parse(
        file: String,
        expectedSlug: String,
        source: String,
    ): ContentPage {
        val text = source.removePrefix("").replace("\r\n", "\n").replace('\r', '\n')
        if (!text.startsWith(FENCE + "\n")) throw ContentException("$file: front matter must start the file")
        val found = text.indexOf("\n" + FENCE + "\n", FENCE.length)
        val closing = if (found < 0 && text.endsWith("\n" + FENCE)) text.length - FENCE.length - 1 else found
        if (closing < 0) throw ContentException("$file: front matter is not closed with ---")
        val header = text.substring(FENCE.length + 1, closing)
        val body = text.substring(minOf(text.length, closing + FENCE.length + 2)).trim()
        val values = readYaml(file, header)

        val slug = string(values, "slug")
        val title = string(values, "title")
        val description = string(values, "description")
        val lead = string(values, "lead")
        val problems = mutableListOf<String>()
        if (slug != expectedSlug) problems += "slug '$slug' must equal the file name '$expectedSlug'"
        if (title.isBlank()) problems += "title is missing"
        if (title.codePointCount(0, title.length) > TITLE_MAX) problems += "title is longer than $TITLE_MAX characters"
        if (description.isBlank()) problems += "description is missing"
        if (description.codePointCount(0, description.length) > DESCRIPTION_MAX) {
            problems += "description is longer than $DESCRIPTION_MAX characters"
        }
        if (lead.isBlank()) problems += "lead is missing"
        if (body.isBlank()) problems += "body is empty"
        val updated = date(values["updated"])
        if (updated == null) problems += "updated must be an ISO date"
        val faq = faq(values["faq"], problems)
        if (problems.isNotEmpty()) throw ContentException("$file: " + problems.joinToString("; "))

        return ContentPage(
            file = file,
            slug = slug,
            title = title,
            description = description,
            updated = checkNotNull(updated),
            lead = lead,
            keywords = list(values["keywords"]),
            breadcrumb = string(values, "breadcrumb"),
            faq = faq,
            markdown = body,
            html = MarkdownRenderer.render(body),
        )
    }

    private fun readYaml(
        file: String,
        header: String,
    ): Map<*, *> {
        val loaded =
            try {
                Yaml(SafeConstructor(LoaderOptions())).load<Any?>(header)
            } catch (exception: RuntimeException) {
                throw ContentException("$file: front matter is not valid YAML (${exception.javaClass.simpleName})")
            }
        return loaded as? Map<*, *> ?: throw ContentException("$file: front matter must be a key/value map")
    }

    private fun string(
        values: Map<*, *>,
        key: String,
    ): String = values[key]?.toString()?.trim().orEmpty()

    private fun list(value: Any?): List<String> =
        when (value) {
            is List<*> -> value.mapNotNull { it?.toString()?.trim()?.takeIf(String::isNotEmpty) }
            is String -> value.split(',').map { it.trim() }.filter { it.isNotEmpty() }
            else -> emptyList()
        }

    private fun date(value: Any?): LocalDate? =
        when (value) {
            is Date -> {
                value.toInstant().atZone(ZoneOffset.UTC).toLocalDate()
            }

            is LocalDate -> {
                value
            }

            is String -> {
                try {
                    LocalDate.parse(value.trim())
                } catch (_: DateTimeParseException) {
                    null
                }
            }

            else -> {
                null
            }
        }

    private fun faq(
        value: Any?,
        problems: MutableList<String>,
    ): List<FaqItem> {
        if (value == null) return emptyList()
        val items = value as? List<*>
        if (items == null) {
            problems += "faq must be a list"
            return emptyList()
        }
        return items.mapIndexedNotNull { index, item ->
            val map = item as? Map<*, *>
            val question =
                map
                    ?.get("q")
                    ?.toString()
                    ?.trim()
                    .orEmpty()
            val answer =
                map
                    ?.get("a")
                    ?.toString()
                    ?.trim()
                    .orEmpty()
            if (question.isEmpty() || answer.isEmpty()) {
                problems += "faq item ${index + 1} needs q and a"
                null
            } else {
                FaqItem(question, answer)
            }
        }
    }

    private const val FENCE = "---"
}
