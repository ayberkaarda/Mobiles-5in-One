package app.cetele.android.core.designsystem

import android.app.Application
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import app.cetele.android.core.designsystem.component.RoleGate
import app.cetele.android.core.domain.model.ShopRole
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class, qualifiers = "tr")
class RoleGateTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun staffCannotSeeOwnerControlsAndUnknownRoleCannotSeeEitherControl() {
        compose.setContent {
            CeteleTheme {
                Column {
                    RoleGate(ShopRole.STAFF, ShopRole.OWNER) { Text("Müşteriyi sil") }
                    RoleGate(ShopRole.STAFF, ShopRole.STAFF) { Text("Borç yaz") }
                    RoleGate(null, ShopRole.STAFF) { Text("Tahsilat al") }
                }
            }
        }
        compose.onNodeWithText("Müşteriyi sil").assertDoesNotExist()
        compose.onNodeWithText("Borç yaz").assertIsDisplayed()
        compose.onNodeWithText("Tahsilat al").assertDoesNotExist()
    }

    @Test
    fun ownerCanSeeOwnerAndStaffControls() {
        compose.setContent {
            CeteleTheme {
                Column {
                    RoleGate(ShopRole.OWNER, ShopRole.OWNER) { Text("Müşteriyi sil") }
                    RoleGate(ShopRole.OWNER, ShopRole.STAFF) { Text("Borç yaz") }
                }
            }
        }
        compose.onNodeWithText("Müşteriyi sil").assertIsDisplayed()
        compose.onNodeWithText("Borç yaz").assertIsDisplayed()
    }
}
