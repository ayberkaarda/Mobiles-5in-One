package app.cetele.android.core.designsystem

import app.cetele.android.core.designsystem.copy.ProblemCodeText
import app.cetele.android.core.network.dto.problem.ProblemCodes
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

class ProblemCodeTextTest {
    private val sourceRoot =
        File(requireNotNull(System.getProperty("cetele.brandTokens")))
            .toPath()
            .parent
            .parent
            .resolve("android/core/designsystem/src/main/res")
            .toFile()

    @Test
    fun `every registry code maps to its named resource with translated copy`() {
        val tr = strings("values")
        val en = strings("values-en")
        val codes =
            ProblemCodes::class.java.fields.filter { it.type == String::class.java }.map {
                it.get(
                    null,
                ) as String
            }
        assertFalse(codes.isEmpty())
        codes.forEach { code ->
            val id = ProblemCodeText.resId(code)
            assertNotNull(id, code)
            val key = "error_" + code.replace('.', '_')
            assertEquals(R.string::class.java.getField(key).getInt(null), id, code)
            assertTrue(tr.getValue(key).isNotBlank(), key)
            assertTrue(en.getValue(key).isNotBlank(), key)
        }
    }

    @Test
    fun `all shared strings have Turkish and English parity including format arguments`() {
        val tr = strings("values")
        val en = strings("values-en")
        assertEquals(tr.keys, en.keys)
        val formats = Regex("%[0-9]+\\$[ds]")
        tr.forEach { (key, text) ->
            assertTrue(text.isNotBlank(), key)
            assertTrue(en.getValue(key).isNotBlank(), key)
            assertEquals(
                formats
                    .findAll(text)
                    .map {
                        it.value
                    }.toList(),
                formats.findAll(en.getValue(key)).map { it.value }.toList(),
                key,
            )
        }
    }

    @Test
    fun `unknown and missing codes fall back without using server titles`() {
        assertNull(ProblemCodeText.resId("unexpected.code"))
        assertNull(ProblemCodeText.resId(null))
        assertEquals(R.string.error_generic, ProblemCodeText.resIdOrGeneric("unexpected.code"))
        assertEquals(R.string.error_generic, ProblemCodeText.resIdOrGeneric(null))
    }

    private fun strings(directory: String): Map<String, String> {
        val document =
            DocumentBuilderFactory
                .newInstance()
                .newDocumentBuilder()
                .parse(sourceRoot.resolve("$directory/strings.xml"))
        val nodes = document.getElementsByTagName("string")
        return (0 until nodes.length).associate { index ->
            val node = nodes.item(index)
            node.attributes.getNamedItem("name").nodeValue to node.textContent
        }
    }
}
