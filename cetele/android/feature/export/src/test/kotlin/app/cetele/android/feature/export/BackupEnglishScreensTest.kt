package app.cetele.android.feature.export

import android.app.Application
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.feature.export.backup.BackupExportScreen
import app.cetele.android.feature.export.backup.BackupImportScreen
import app.cetele.android.feature.export.backup.BackupUiState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class, qualifiers = "en")
class BackupEnglishScreensTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun englishCopyIsUsedForBothScreens() {
        val owner = BackupUiState(loading = false, shops = listOf(shop), selectedShopId = shop.id)
        compose.setContent {
            CeteleTheme {
                BackupExportScreen(owner, {}, { _, _ -> }, {})
                BackupImportScreen(owner, {}, {}, {}, {}, {})
            }
        }
        compose.onNodeWithText("Create and share backup").assertExists()
        compose.onNodeWithText("Type the passphrase again").assertExists()
        compose.onNodeWithText("Choose backup file").assertExists()
    }

    @Test
    fun turkishAndEnglishHaveTheSameKeysAndPlaceholders() {
        val turkish = strings("values")
        val english = strings("values-en")
        assertEquals(turkish.keys, english.keys)
        for ((key, value) in turkish) {
            assertEquals(key, placeholders(value), placeholders(english.getValue(key)))
        }
    }

    private fun placeholders(value: String): List<String> =
        Regex("%\\d+\\$[sd]")
            .findAll(value)
            .map { it.value }
            .sorted()
            .toList()

    private fun strings(folder: String): Map<String, String> {
        val file =
            sequenceOf("src/main/res", "feature/export/src/main/res", "cetele/android/feature/export/src/main/res")
                .map { File(it, "$folder/strings.xml") }
                .first { it.isFile }
        val nodes =
            DocumentBuilderFactory
                .newInstance()
                .newDocumentBuilder()
                .parse(file)
                .getElementsByTagName("string")
        return (0 until nodes.length).associate { index ->
            val node = nodes.item(index)
            node.attributes.getNamedItem("name").nodeValue to node.textContent
        }
    }
}
