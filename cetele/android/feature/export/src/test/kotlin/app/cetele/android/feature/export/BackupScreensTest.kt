package app.cetele.android.feature.export

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.text.AnnotatedString
import app.cetele.android.core.data.backup.BackupMergeResult
import app.cetele.android.core.data.backup.BackupPreview
import app.cetele.android.core.data.backup.BackupSnapshot
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.feature.export.backup.BackupExportScreen
import app.cetele.android.feature.export.backup.BackupImportScreen
import app.cetele.android.feature.export.backup.BackupUiState
import app.cetele.android.feature.export.backup.ExportedCounts
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class, qualifiers = "tr")
class BackupScreensTest {
    @get:Rule
    val compose = createComposeRule()

    private val owner = BackupUiState(loading = false, shops = listOf(shop), selectedShopId = shop.id)
    private val password = SemanticsMatcher.keyIsDefined(SemanticsProperties.Password)
    private val masked =
        SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("•".repeat(15)))

    @Test
    fun ownerChoosesShopAndTypesThePassphraseTwiceInMaskedFields() {
        var submitted: Pair<String, String>? = null
        compose.setContent {
            CeteleTheme { BackupExportScreen(owner, {}, { a, b -> submitted = a to b }, {}) }
        }
        compose.onNodeWithText(shop.name).assertIsSelected()
        compose.onNodeWithText("Parola").assert(password).performTextInput("uzun bir parola")
        compose.onNodeWithText("Parolayı tekrar yazın").assert(password).performTextInput("uzun bir parola")
        compose.onNodeWithText("Parola").assert(masked)
        compose.onNodeWithText("Yedeği oluştur ve paylaş").performScrollTo().performClick()
        assertEquals("uzun bir parola" to "uzun bir parola", submitted)
    }

    @Test
    fun exportShowsPassphraseErrorAndReadyCounts() {
        val state =
            owner.copy(passphraseError = R.string.export_backup_passphrase_mismatch, exported = ExportedCounts(2, 7))
        compose.setContent { CeteleTheme { BackupExportScreen(state, {}, { _, _ -> }, {}) } }
        compose.onNodeWithText("İki parola aynı değil.").assertExists()
        compose.onNodeWithText("Yedek hazır. Müşteri: 2 · Kayıt: 7").assertExists()
    }

    @Test
    fun staffSeesOnlyTheOwnerNoticeOnBothScreens() {
        val staff = BackupUiState(loading = false)
        compose.setContent {
            CeteleTheme {
                BackupExportScreen(staff, {}, { _, _ -> }, {})
                BackupImportScreen(staff, {}, {}, {}, {}, {})
            }
        }
        compose.onNodeWithText("Yedeği oluştur ve paylaş").assertDoesNotExist()
        compose.onNodeWithText("Yedek dosyası seç").assertDoesNotExist()
        compose.onNodeWithText("Parola").assertDoesNotExist()
    }

    @Test
    fun importAsksForPassphraseOnlyAfterAFileIsChosen() {
        var opened: String? = null
        var state by mutableStateOf(owner)
        compose.setContent {
            CeteleTheme {
                BackupImportScreen(
                    state,
                    { state = owner.copy(fileLoaded = true) },
                    { opened = it },
                    {},
                    {},
                    {},
                )
            }
        }
        compose.onNodeWithText("Parola").assertDoesNotExist()
        compose.onNodeWithText("Yedek dosyası seç").performClick()
        compose.onNodeWithText("Yedeği aç").assertIsNotEnabled()
        compose.onNodeWithText("Parola").assert(password).performTextInput("uzun bir parola")
        compose.onNodeWithText("Yedeği aç").assertIsEnabled().performClick()
        assertEquals("uzun bir parola", opened)
    }

    @Test
    fun previewShowsCountsAndImportsOnlyOnConfirm() {
        var confirmed = 0
        val preview =
            BackupPreview(
                BackupSnapshot(
                    shopId = shop.id,
                    shopName = shop.name,
                    exportedAt = instant.toString(),
                    customers = emptyList(),
                    entries = emptyList(),
                ),
                newCustomers = 1,
                newEntries = 4,
            )
        compose.setContent {
            CeteleTheme {
                BackupImportScreen(owner.copy(fileLoaded = true, preview = preview), {}, {}, { confirmed++ }, {}, {})
            }
        }
        compose.onNodeWithText(shop.name).assertIsDisplayed()
        compose.onNodeWithText("Yedek tarihi: 6 Ekim 2026").assertExists()
        compose.onNodeWithText("Bu cihaza eklenecek. Müşteri: 1 · Kayıt: 4").assertExists()
        assertEquals(0, confirmed)
        compose.onNodeWithText("İçe aktar").performClick()
        assertEquals(1, confirmed)
    }

    @Test
    fun finishedImportReportsAddedCounts() {
        val state = owner.copy(imported = BackupMergeResult.Ok(2, 9), errorRes = R.string.export_common_error)
        compose.setContent { CeteleTheme { BackupImportScreen(state, {}, {}, {}, {}, {}) } }
        compose.onNodeWithText("İçe aktarma tamamlandı. Eklenen müşteri: 2 · Eklenen kayıt: 9").assertExists()
        compose.onNodeWithText("Bitti").assertIsDisplayed()
    }

    @Test
    fun wrongPassphraseMessageIsShown() {
        val state = owner.copy(fileLoaded = true, errorRes = R.string.export_restore_authentication)
        compose.setContent { CeteleTheme { BackupImportScreen(state, {}, {}, {}, {}, {}) } }
        compose.onNodeWithText("Parola yanlış ya da dosya değiştirilmiş.").assertExists()
    }
}
