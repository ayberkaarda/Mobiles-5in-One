package app.cetele.android.feature.shop

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.network.dto.shops.MemberView
import app.cetele.android.feature.shop.members.MembersScreen
import app.cetele.android.feature.shop.members.MembersState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.Instant
import app.cetele.android.core.network.dto.ShopRole as WireRole

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class, qualifiers = "tr")
class MembersScreenTest {
    @get:Rule val compose = createComposeRule()
    private val member = MemberView("member-one", "+905321234567", "Deniz", WireRole.STAFF, Instant.EPOCH)

    @Test fun staffSeesNoManagementControlsOrMemberDataEvenWithStaleState() {
        compose.setContent {
            CeteleTheme {
                MembersScreen(MembersState("shop-one", ShopRole.STAFF, listOf(member), member), {}, {}, {}, {}, {}, {})
            }
        }
        compose.onNodeWithText("Bu işlemi yalnızca dükkân sahibi yapabilir").assertIsDisplayed()
        compose.onNodeWithText("Çalışan davet et").assertDoesNotExist()
        compose.onNodeWithText("Üyeyi çıkar").assertDoesNotExist()
        compose.onNodeWithText("Deniz").assertDoesNotExist()
        compose.onNodeWithText("Yenile").assertDoesNotExist()
    }

    @Test fun ownerRemovalRequiresConfirmationAndCancelDoesNotRemove() {
        var state by mutableStateOf(MembersState("shop-one", ShopRole.OWNER, listOf(member)))
        var removals = 0
        compose.setContent {
            CeteleTheme {
                MembersScreen(
                    state,
                    {},
                    { state = state.copy(removal = it) },
                    {
                        removals++
                        state = state.copy(removal = null)
                    },
                    { state = state.copy(removal = null) },
                    {},
                    {},
                )
            }
        }
        compose.onNodeWithText("Çalışan davet et").assertIsDisplayed()
        compose.onNodeWithText("Üyeyi çıkar").performClick()
        compose
            .onNodeWithText(
                "Bu kişinin dükkân defterine erişimi sona erecek. Üyeyi çıkarmak istiyor musunuz?",
            ).assertIsDisplayed()
        compose.runOnIdle { assertEquals(0, removals) }
        compose.onNodeWithText("Vazgeç").performClick()
        compose.runOnIdle { assertEquals(0, removals) }
    }

    @Test fun lockedOwnerProblemUsesSharedCopy() {
        compose.setContent {
            CeteleTheme {
                MembersScreen(MembersState(role = ShopRole.OWNER, failure = ShopFailure("membership.owner_locked")), {
                }, {}, {}, {}, {}, {})
            }
        }
        val context =
            androidx.test.core.app.ApplicationProvider
                .getApplicationContext<Application>()
        val resource =
            app.cetele.android.core.designsystem.copy.ProblemCodeText.resIdOrGeneric(
                "membership.owner_locked",
            )
        compose.onNodeWithText(context.getString(resource)).assertIsDisplayed()
    }
}
