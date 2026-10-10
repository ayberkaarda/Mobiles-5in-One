package app.cetele.android.core.designsystem

import android.app.Application
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import app.cetele.android.core.designsystem.component.BannerKind
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.designsystem.component.ProblemBanner
import app.cetele.android.core.designsystem.component.StatusBanner
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class, qualifiers = "tr")
class StatusBannerTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun offlineCopyAndActionAreAccessible() {
        var clicks = 0
        compose.setContent {
            CeteleTheme {
                StatusBanner(BannerKind.Offline, "Çevrimdışısınız, kayıtlar bağlanınca gönderilecek", action = {
                    CeteleButton("Tamam", { clicks++ })
                })
            }
        }
        compose.onNodeWithText("Çevrimdışısınız, kayıtlar bağlanınca gönderilecek").assertIsDisplayed()
        compose
            .onNode(
                SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite),
            ).assertIsDisplayed()
        compose.onNodeWithText("Tamam").performClick()
        compose.runOnIdle { assertEquals(1, clicks) }
    }

    @Test
    fun unknownCodeShowsGenericCopyAndSupportCode() {
        compose.setContent { CeteleTheme { ProblemBanner("unrecognized", traceId = "sample-42") } }
        compose.onNodeWithText("İşlem tamamlanamadı. Lütfen daha sonra tekrar deneyin.").assertIsDisplayed()
        compose.onNodeWithText("Destek kodu: sample-42").assertIsDisplayed()
    }

    @Test
    fun knownCodeShowsSpecificCopyWithoutSupportCode() {
        compose.setContent { CeteleTheme { ProblemBanner("sms.provider_failed", traceId = "sample-42") } }
        compose.onNodeWithText("Gönderilmiş olabilir, tekrar denemeyin").assertIsDisplayed()
        compose.onNodeWithText("Destek kodu: sample-42").assertDoesNotExist()
    }
}
