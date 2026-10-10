package app.cetele.android.feature.shop

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.network.dto.ShopType
import app.cetele.android.feature.shop.create.CreateShopScreen
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class, qualifiers = "tr")
class CreateShopScreenTest {
    @get:Rule val compose = createComposeRule()

    @Test fun emptySubmissionShowsEachFieldMessage() {
        var state by mutableStateOf(ShopFormState())
        compose.setContent {
            CeteleTheme {
                CreateShopScreen(
                    state,
                    { state = state.copy(form = it) },
                    { state = state.copy(errors = state.form.errors()) },
                    {},
                    {},
                )
            }
        }
        compose.onNodeWithText("Dükkân aç").performScrollTo().performClick()
        for (copy in listOf("Dükkân adını yazın", "Dükkân türünü seçin", "İlinizi yazın", "İlçenizi yazın")) {
            compose.onNodeWithText(copy).performScrollTo().assertIsDisplayed()
        }
    }

    @Test fun fieldsAndTypeChipProduceTheExpectedRequest() {
        var state by mutableStateOf(ShopFormState())
        var submitted: ShopForm? = null
        compose.setContent {
            CeteleTheme {
                CreateShopScreen(state, { state = ShopFormState(it) }, { submitted = state.form }, {}, {})
            }
        }
        compose.onNodeWithText("Dükkân adı").performScrollTo().performTextInput("Market")
        compose.onNodeWithText("Manav").performScrollTo().performClick()
        compose.onNodeWithText("İl").performScrollTo().performTextInput("İstanbul")
        compose.onNodeWithText("İlçe").performScrollTo().performTextInput("Kadıköy")
        compose.onNodeWithText("Dükkân aç").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(ShopForm("Market", ShopType.MANAV, "İstanbul", "Kadıköy"), submitted) }
    }
}
