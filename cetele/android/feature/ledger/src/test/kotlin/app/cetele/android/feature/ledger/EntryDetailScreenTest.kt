package app.cetele.android.feature.ledger

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.feature.ledger.entry.EntryDetailActions
import app.cetele.android.feature.ledger.entry.EntryDetailScreen
import app.cetele.android.feature.ledger.entry.EntryDetailState
import app.cetele.android.feature.ledger.photo.EntryPhotoStatus
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class, qualifiers = "tr")
class EntryDetailScreenTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun reversalRequiresConfirmationBeforeCallingTheWrite() {
        var confirmed = 0
        compose.setContent {
            var confirm by remember { mutableStateOf(false) }
            CeteleTheme {
                EntryDetailScreen(
                    EntryDetailState(entry = LedgerFixtures.entry(), loading = false, confirmReversal = confirm),
                    EntryDetailActions(
                        onBack = { confirm = false },
                        onEntrySelected = { confirmed = -1 },
                        onRequestReversal = { confirm = true },
                        onConfirmReversal = {
                            confirmed++
                            confirm = false
                        },
                        onDismissReversal = { confirm = false },
                    ),
                )
            }
        }
        compose.onNodeWithText("Düzelt").performScrollTo().performClick()
        compose.onNodeWithText("Bu kayıt geri alınacak ve bir düzeltme kaydı oluşturulacak").assertIsDisplayed()
        compose.runOnIdle { assertEquals(0, confirmed) }
        compose.onAllNodesWithText("Düzelt").onLast().performClick()
        compose.runOnIdle { assertEquals(1, confirmed) }
        compose.onNodeWithText("Bu kayıt geri alınacak ve bir düzeltme kaydı oluşturulacak").assertDoesNotExist()
    }

    @Test
    fun reversedEntryShowsCorrectionLinkAndHasNoCorrectionAction() {
        var selected: String? = null
        var requests = 0
        compose.setContent {
            CeteleTheme {
                EntryDetailScreen(
                    EntryDetailState(entry = LedgerFixtures.entry(reversedBy = "correction-a"), loading = false),
                    actions(onSelected = { selected = it }, onRequest = { requests++ }),
                )
            }
        }
        compose.onNodeWithText("Düzelt").assertDoesNotExist()
        compose.onNodeWithText("Düzeltme kaydını aç").performScrollTo().performClick()
        compose.runOnIdle {
            assertEquals("correction-a", selected)
            assertEquals(0, requests)
        }
    }

    @Test
    fun reversalEntryLinksToOriginalAndHasNoCorrectionAction() {
        var selected: String? = null
        compose.setContent {
            CeteleTheme {
                EntryDetailScreen(
                    EntryDetailState(entry = LedgerFixtures.entry(reverses = "original-a"), loading = false),
                    actions(onSelected = { selected = it }, onRequest = { selected = "incorrect" }),
                )
            }
        }
        compose.onNodeWithText("Düzelt").assertDoesNotExist()
        compose.onNodeWithText("Asıl kaydı aç").performScrollTo().performClick()
        compose.runOnIdle { assertEquals("original-a", selected) }
    }

    @Test
    fun pendingPhotoUploadIsAnnouncedAndPhotoContentIsShown() {
        var shown: String? = null
        compose.setContent {
            CeteleTheme {
                EntryDetailScreen(
                    EntryDetailState(
                        entry = LedgerFixtures.entry(),
                        loading = false,
                        photoStatus = EntryPhotoStatus.Uploading,
                    ),
                    actions(onSelected = {}, onRequest = {}),
                    photoContent = { entry -> shown = entry.id },
                )
            }
        }
        compose.onNodeWithText("Fotoğraf yükleniyor").performScrollTo().assertIsDisplayed()
        compose.runOnIdle { assertEquals("entry-a", shown) }
    }

    @Test
    fun failedPhotoUploadOffersSendingWithoutPhoto() {
        var released = 0
        compose.setContent {
            CeteleTheme {
                EntryDetailScreen(
                    EntryDetailState(
                        entry = LedgerFixtures.entry(),
                        loading = false,
                        photoStatus = EntryPhotoStatus.Failed,
                    ),
                    actions(onSelected = {}, onRequest = {}).copy(onSendWithoutPhoto = { released++ }),
                    photoContent = {},
                )
            }
        }
        compose
            .onNodeWithText("Fotoğraf yüklenemedi. Kayıt fotoğraf olmadan gönderilebilir.")
            .performScrollTo()
            .assertIsDisplayed()
        compose.onNodeWithText("Fotoğraf yükleniyor").assertDoesNotExist()
        compose.onNodeWithText("Fotoğrafsız gönder").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(1, released) }
    }

    @Test
    fun uploadingPhotoHasNoSendWithoutPhotoAction() {
        compose.setContent {
            CeteleTheme {
                EntryDetailScreen(
                    EntryDetailState(
                        entry = LedgerFixtures.entry(),
                        loading = false,
                        photoStatus = EntryPhotoStatus.Uploading,
                    ),
                    actions(onSelected = {}, onRequest = {}),
                    photoContent = {},
                )
            }
        }
        compose.onNodeWithText("Fotoğrafsız gönder").assertDoesNotExist()
    }

    @Test
    fun entryWithoutPhotoShowsNoPhotoContent() {
        var shown = false
        compose.setContent {
            CeteleTheme {
                EntryDetailScreen(
                    EntryDetailState(entry = LedgerFixtures.entry(), loading = false),
                    actions(onSelected = {}, onRequest = {}),
                    photoContent = { shown = true },
                )
            }
        }
        compose.onNodeWithText("Fotoğraf yükleniyor").assertDoesNotExist()
        compose.runOnIdle { assertEquals(false, shown) }
    }

    private fun actions(
        onSelected: (String) -> Unit,
        onRequest: () -> Unit,
    ) = EntryDetailActions(
        onBack = onRequest,
        onEntrySelected = onSelected,
        onRequestReversal = onRequest,
        onConfirmReversal = onRequest,
        onDismissReversal = onRequest,
    )
}
