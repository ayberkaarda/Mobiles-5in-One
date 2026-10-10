package app.cetele.android.feature.export

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.domain.ledger.StatementRows
import app.cetele.android.core.domain.model.ShopRole
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class, qualifiers = "tr")
class ExportScreensTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun staffCannotSeeTheCsvEntryOrSummary() {
        compose.setContent {
            CeteleTheme {
                ExportAllScreen(
                    ExportSnapshot(shop = shop.copy(role = ShopRole.STAFF), loading = false),
                    ExportActionState(),
                    {},
                    {},
                )
            }
        }
        compose.onNodeWithText("Tüm kayıtları CSV olarak paylaş").assertDoesNotExist()
        compose.onNodeWithText(shop.name).assertDoesNotExist()
    }

    @Test
    fun statementShowsBalanceAndServerDownloadOnlyOnFontError() {
        val data =
            ExportSnapshot(shop, customer, StatementRows.build(listOf(entry())), loading = false, available = true)
        compose.setContent {
            CeteleTheme {
                ExportStatementScreen(
                    data,
                    ExportActionState(fontsUnavailable = true, errorRes = R.string.export_statement_fonts_error),
                    {},
                    {},
                    {},
                )
            }
        }
        compose.onNodeWithText("₺1.250,00").assertIsDisplayed()
        compose.onNodeWithText("Paylaş").assertIsDisplayed()
        compose.onNodeWithText("Sunucudan indir").assertExists()
    }

    @Test
    fun staffCanShareAStatementAndHasNoServerFallbackOnSuccess() {
        val data = ExportSnapshot(shop.copy(role = ShopRole.STAFF), customer, loading = false, available = true)
        compose.setContent { CeteleTheme { ExportStatementScreen(data, ExportActionState(), {}, {}, {}) } }
        compose.onNodeWithText("Paylaş").assertIsDisplayed()
        compose.onNodeWithText("Sunucudan indir").assertDoesNotExist()
    }
}
