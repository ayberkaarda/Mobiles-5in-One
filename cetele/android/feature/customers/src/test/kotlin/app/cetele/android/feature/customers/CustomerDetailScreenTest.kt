package app.cetele.android.feature.customers

import android.app.Application
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.style.TextDecoration
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.domain.ledger.StatementRows
import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.core.domain.model.Money
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.feature.customers.detail.CustomerDetailScreen
import app.cetele.android.feature.customers.detail.CustomerDetailState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class, qualifiers = "tr")
class CustomerDetailScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private fun show(
        role: ShopRole,
        onDelete: () -> Unit = {},
        onAdd: (EntryType) -> Unit = {},
    ) {
        val entries =
            listOf(sampleEntry(reversedBy = "correction"), sampleEntry(id = "correction", reverses = "entry-one"))
        compose.setContent {
            CeteleTheme {
                CustomerDetailScreen(
                    CustomerDetailState(
                        sampleCustomer(),
                        role,
                        Money(1200),
                        StatementRows.build(entries),
                        loading = false,
                    ),
                    onAdd,
                    {},
                    {},
                    {},
                    {},
                    onDelete,
                    {},
                )
            }
        }
    }

    @Test
    fun statementShowsBalanceAndReversedRow() {
        show(ShopRole.OWNER)
        compose.onNodeWithText("₺12,00").assertIsDisplayed()
        compose.onNodeWithText("Düzeltilmiş kayıt").assertIsDisplayed()
        val layouts = mutableListOf<TextLayoutResult>()
        val amounts = compose.onAllNodesWithText("₺1.250,00", useUnmergedTree = true)
        repeat(2) { index ->
            amounts[index].performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
        }
        compose.runOnIdle {
            val decorations = layouts.map { it.layoutInput.style.textDecoration }
            assertEquals(2, decorations.size)
            assertEquals(1, decorations.count { it == TextDecoration.LineThrough })
            assertEquals(1, decorations.count { it == TextDecoration.None })
        }
        compose.onNodeWithTag("customer-statement").performScrollToNode(hasText("Düzeltme"))
        compose.onNodeWithText("Düzeltme").assertIsDisplayed()
    }

    @Test
    fun staffSeesEditAndStatementButNoDelete() {
        show(ShopRole.STAFF)
        compose.onNodeWithText("Hesap dökümü").assertIsDisplayed()
        compose.onNodeWithText("Diğer işlemler").performClick()
        compose.onNodeWithText("Düzenle").assertIsDisplayed()
        compose.onNodeWithText("Müşteriyi sil").assertDoesNotExist()
    }

    @Test
    fun ownerMustConfirmBeforeDeletion() {
        var deletions = 0
        show(ShopRole.OWNER, onDelete = { deletions++ })
        compose.onNodeWithText("Diğer işlemler").performClick()
        compose.onNodeWithText("Müşteriyi sil").performClick()
        compose.onNodeWithText("Müşteri ve kayıtları bu dükkânın defterinden kaldırılır").assertIsDisplayed()
        compose.runOnIdle { assertEquals(0, deletions) }
        compose.onNodeWithText("Sil").performClick()
        compose.runOnIdle { assertEquals(1, deletions) }
    }

    @Test
    fun debtAndPaymentActionsPreserveType() {
        val types = mutableListOf<EntryType>()
        show(ShopRole.STAFF, onAdd = { types.add(it) })
        compose.onNodeWithText("Borç yaz").performClick()
        compose.onNodeWithText("Tahsilat al").performClick()
        compose.runOnIdle { assertEquals(listOf(EntryType.DEBT, EntryType.PAYMENT), types) }
    }
}
