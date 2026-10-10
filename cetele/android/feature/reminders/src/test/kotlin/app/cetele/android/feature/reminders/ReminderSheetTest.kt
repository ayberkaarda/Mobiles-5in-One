package app.cetele.android.feature.reminders

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import app.cetele.android.core.data.database.entity.ReminderLogEntity
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.network.dto.reminders.QuotaState
import app.cetele.android.feature.reminders.sheet.ReminderSheet
import app.cetele.android.feature.reminders.sheet.ReminderState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class, qualifiers = "tr-w411dp-h1600dp")
class ReminderSheetTest {
    @get:Rule
    val compose = createComposeRule()

    private fun ready(): ReminderState =
        ReminderState(
            shop = reminderShop(),
            customer = reminderCustomer(),
            balanceMinor = 125000,
        )

    @Test
    fun balanceQuotaAndDeviceLocalHistoryAreShown() {
        compose.setContent {
            CeteleTheme {
                ReminderSheet(
                    ready().copy(
                        quota = QuotaState("2026-10", 7, 30),
                        lastReminder =
                            ReminderLogEntity(
                                "log",
                                "shop",
                                "customer",
                                "SMS",
                                reminderTime.toString(),
                                "SENT",
                                7,
                                30,
                            ),
                    ),
                    {},
                    {},
                    {},
                )
            }
        }
        compose.onNodeWithText("₺1.250,00").assertIsDisplayed()
        compose.onNodeWithText("Bu ay 7/30 SMS").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Son hatırlatma: 6 Ekim 2026 (SMS, bu cihazdan)").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun consentMissingDisablesOnlySmsAndExplainsWhy() {
        compose.setContent {
            CeteleTheme {
                ReminderSheet(ready().copy(customer = reminderCustomer().copy(smsConsent = false)), {}, {}, {})
            }
        }
        compose.onNodeWithText("WhatsApp ile gönder").assertIsEnabled()
        compose.onNodeWithText("SMS gönder").assertIsNotEnabled()
        compose.onNodeWithText("Müşterinin SMS hatırlatma izni kayıtlı değil").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun missingPhoneDisablesBothActions() {
        compose.setContent {
            CeteleTheme {
                ReminderSheet(ready().copy(customer = reminderCustomer().copy(phone = null)), {}, {}, {})
            }
        }
        compose.onNodeWithText("WhatsApp ile gönder").assertIsNotEnabled()
        compose.onNodeWithText("SMS gönder").assertIsNotEnabled()
    }

    @Test
    fun noDebtDisablesBothActions() {
        compose.setContent {
            CeteleTheme { ReminderSheet(ready().copy(balanceMinor = 0), {}, {}, {}) }
        }
        compose.onNodeWithText("WhatsApp ile gönder").assertIsNotEnabled()
        compose.onNodeWithText("SMS gönder").assertIsNotEnabled()
    }

    @Test
    fun actionsInvokeTheirOwnCallbacks() {
        var shares = 0
        var messages = 0
        compose.setContent {
            CeteleTheme { ReminderSheet(ready(), { shares++ }, { messages++ }, {}) }
        }
        compose.onNodeWithText("WhatsApp ile gönder").performClick()
        compose.onNodeWithText("SMS gönder").performClick()
        compose.runOnIdle {
            assertEquals(1, shares)
            assertEquals(1, messages)
        }
    }

    @Test
    fun pendingRequestDisablesBothActions() {
        compose.setContent {
            CeteleTheme { ReminderSheet(ready().copy(busy = true), {}, {}, {}) }
        }
        compose.onNodeWithText("WhatsApp ile gönder").assertIsNotEnabled()
        compose.onNodeWithText("SMS gönder").assertIsNotEnabled()
    }

    @Test
    fun providerFailureShowsWarningAndDisablesSms() {
        compose.setContent {
            CeteleTheme { ReminderSheet(ready().copy(smsUncertain = true), {}, {}, {}) }
        }
        compose.onNodeWithText("SMS gönder").assertIsNotEnabled()
        compose.onNodeWithText("Gönderilmiş olabilir, tekrar denemeyin").performScrollTo().assertIsDisplayed()
    }
}
