package app.cetele.android.feature.ledger

import android.app.Application
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.media.ImageCompressor
import app.cetele.android.core.data.repository.LedgerRepository
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.data.write.EntryDraft
import app.cetele.android.core.data.write.WriteResult
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.feature.ledger.entry.EntryEditActions
import app.cetele.android.feature.ledger.entry.EntryEditScreen
import app.cetele.android.feature.ledger.entry.EntryEditViewModel
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class, qualifiers = "tr")
class EntryEditScreenTest {
    @get:Rule
    val compose = createComposeRule()
    private val ledger = mockk<LedgerRepository>()
    private val shops = mockk<ShopRepository>()
    private val draft = slot<EntryDraft>()
    private lateinit var model: EntryEditViewModel

    @Test
    fun keypadDecimalSaves1250MinorUnits() {
        show()
        enter("12,50")
        compose.onNodeWithText("Kaydet").performScrollTo().performClick()
        compose.waitUntil { model.state.value.savedId != null }
        compose.runOnIdle {
            assertEquals(1250L, draft.captured.amountMinor)
            assertEquals(EntryType.DEBT, draft.captured.type)
        }
        coVerify(exactly = 1) { ledger.create("shop-a", any(), null) }
    }

    @Test
    fun debtShowsDueDateAndPaymentHidesIt() {
        show()
        compose.onNodeWithText("Vade").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Tahsilat").performScrollTo().performClick()
        compose.onNodeWithText("Vade").assertDoesNotExist()
        compose.onNodeWithText("Borç").performClick()
        compose.onNodeWithText("Vade").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun zeroAmountShowsValidationCopyAndWritesNothing() {
        show()
        compose.onNodeWithText("Kaydet").performScrollTo().performClick()
        compose
            .onNodeWithText("0,01 ile 100.000.000,00 lira arasında bir tutar girin")
            .performScrollTo()
            .assertIsDisplayed()
        coVerify(exactly = 0) { ledger.create(any(), any(), any()) }
    }

    private fun show() {
        every { shops.observeActive() } returns MutableStateFlow(LedgerFixtures.shop())
        coEvery { ledger.create("shop-a", capture(draft), any()) } returns WriteResult.Ok("saved-entry")
        compose.setContent {
            model =
                remember {
                    EntryEditViewModel(
                        SavedStateHandle(mapOf("customerId" to "customer-a", "type" to EntryType.DEBT.name)),
                        ledger,
                        shops,
                        mockk<ImageCompressor>(),
                        LedgerFixtures.clock,
                    )
                }
            DisposableEffect(model) { onDispose { model.viewModelScope.cancel() } }
            val state by model.state.collectAsState()
            CeteleTheme {
                EntryEditScreen(
                    state,
                    EntryEditActions(
                        model::setAmount,
                        model::setType,
                        model::setOccurredOn,
                        model::setDueOn,
                        model::setNote,
                        model::captureFailed,
                        model::removePhoto,
                        model::save,
                        onBack = { model.viewModelScope.cancel() },
                    ),
                )
            }
        }
    }

    private fun enter(text: String) {
        text.forEach { char ->
            compose
                .onNodeWithContentDescription(if (char == ',') "Ondalık ayırıcı" else char.toString())
                .performScrollTo()
                .performClick()
        }
    }
}
