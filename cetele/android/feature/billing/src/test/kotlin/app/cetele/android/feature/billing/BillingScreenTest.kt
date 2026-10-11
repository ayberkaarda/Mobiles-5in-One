package app.cetele.android.feature.billing

import android.app.Application
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.network.dto.billing.SubscriptionState
import app.cetele.android.core.network.dto.problem.ProblemCodes
import app.cetele.android.feature.billing.data.BillingStateMapper
import app.cetele.android.feature.billing.gateway.ProOffer
import app.cetele.android.feature.billing.ui.BillingActions
import app.cetele.android.feature.billing.ui.BillingNotice
import app.cetele.android.feature.billing.ui.BillingScreen
import app.cetele.android.feature.billing.ui.BillingUiState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class, qualifiers = "tr")
class BillingScreenTest {
    @get:Rule val compose = createComposeRule()

    private val subscribed = mutableListOf<ProOffer>()
    private var restores = 0
    private var manages = 0

    @Test
    fun ownerOnFreePlanSeesLimitsUsageAndBothOffersWithPlayPrices() {
        content(
            BillingUiState(
                shop = shop(),
                overview = BillingStateMapper.map(freeState()),
                offers = listOf(monthly, yearly),
            ),
        )
        compose.onNodeWithText("Ücretsiz").assertIsDisplayed()
        compose.onNodeWithText("Müşteriler: 42 / 100").assertIsDisplayed()
        compose.onNodeWithText("Bu ay fotoğraf: 7 / 200").assertIsDisplayed()
        compose.onNodeWithText("Bu ay SMS: 3 / 30").assertIsDisplayed()
        compose.onNodeWithText("Dönem: Ekim 2026").assertIsDisplayed()
        compose
            .onNodeWithContentDescription("Yıllık Çetele Pro aboneliği başlat, yılda ₺499,99")
            .performScrollTo()
            .performClick()
        compose
            .onNodeWithContentDescription("Aylık Çetele Pro aboneliği başlat, ayda ₺49,99")
            .performScrollTo()
            .assertIsDisplayed()
        compose.onNodeWithText("Satın alımları geri yükle").performScrollTo().performClick()
        assertEquals(listOf(yearly), subscribed)
        assertEquals(1, restores)
        compose.onNodeWithText("Aboneliği yönet").assertDoesNotExist()
    }

    @Test
    fun staffSeesReadOnlyPlanWithoutPurchaseButtons() {
        content(
            BillingUiState(
                shop = shop(ShopRole.STAFF),
                overview = BillingStateMapper.map(freeState()),
                offers = listOf(monthly, yearly),
            ),
        )
        compose.onNodeWithText("Müşteriler: 42 / 100").assertIsDisplayed()
        compose
            .onNodeWithText(
                "Dükkân sahibi Çetele Pro'ya geçebilir. Aboneliği yalnızca dükkân sahibi yönetebilir.",
            ).performScrollTo()
            .assertIsDisplayed()
        compose.onNodeWithText("Aylık abone ol · ₺49,99").assertDoesNotExist()
        compose.onNodeWithText("Satın alımları geri yükle").assertDoesNotExist()
        compose.onNodeWithText("Aboneliği yönet").assertDoesNotExist()
    }

    @Test
    fun ownerWithActiveSubscriptionManagesItInPlay() {
        content(
            BillingUiState(
                shop = shop(),
                overview = BillingStateMapper.map(proState()),
                offers = listOf(monthly, yearly),
            ),
        )
        compose.onAllNodesWithText("Çetele Pro").assertCountEquals(2)
        compose.onNodeWithText("Durum: Etkin").assertIsDisplayed()
        compose.onNodeWithText("Aylık plan").assertIsDisplayed()
        compose.onNodeWithText("11 Kasım 2026 tarihinde yenilenir").assertIsDisplayed()
        compose.onNodeWithText("Test satın alması").assertIsDisplayed()
        compose.onNodeWithText("Müşteriler: 137 (sınırsız)").assertIsDisplayed()
        compose
            .onNodeWithContentDescription(
                "Aboneliği Google Play'de yönet veya iptal et",
            ).performScrollTo()
            .performClick()
        assertEquals(1, manages)
        compose.onNodeWithText("Yıllık abone ol · ₺499,99").assertDoesNotExist()
    }

    @Test
    fun staffSeesActiveSubscriptionWithoutManageButton() {
        content(BillingUiState(shop = shop(ShopRole.STAFF), overview = BillingStateMapper.map(proState())))
        compose.onNodeWithText("Durum: Etkin").assertIsDisplayed()
        compose.onNodeWithText("Aboneliği yönet").assertDoesNotExist()
    }

    @Test
    fun pendingPurchaseIsShownAsPaymentPending() {
        val pending = proState(subscription(SubscriptionState.PENDING, entitled = false))
        content(BillingUiState(shop = shop(), overview = BillingStateMapper.map(pending), offers = listOf(monthly)))
        compose.onNodeWithText("Durum: Ödeme bekleniyor").assertIsDisplayed()
        compose
            .onNodeWithText("Ödeme bekleniyor. Ödeme tamamlanınca Çetele Pro kendiliğinden açılır.")
            .assertIsDisplayed()
    }

    @Test
    fun billingErrorCodesUseTheContractCopy() {
        val cases =
            mapOf(
                ProblemCodes.BILLING_PURCHASE_INVALID to "Satın alma doğrulanamadı.",
                ProblemCodes.BILLING_TOKEN_IN_USE to "Bu abonelik başka bir dükkâna ait.",
                ProblemCodes.BILLING_ALREADY_SUBSCRIBED to "Bu dükkânın zaten etkin bir Çetele Pro aboneliği var.",
                ProblemCodes.BILLING_UNAVAILABLE to "Satın alma şu an doğrulanamıyor; biraz sonra yeniden denenecek.",
                "forbidden" to "Aboneliği yalnızca dükkân sahibi yönetebilir.",
            )
        val notice = mutableStateOf<BillingNotice>(BillingNotice.Problem(null))
        compose.setContent {
            CeteleTheme {
                BillingScreen(
                    BillingUiState(
                        shop = shop(),
                        overview = BillingStateMapper.map(freeState()),
                        notice = notice.value,
                    ),
                    actions(),
                )
            }
        }
        cases.forEach { (code, text) ->
            notice.value = BillingNotice.Problem(code)
            compose.onNodeWithText(text).assertIsDisplayed()
        }
    }

    @Test
    fun storeUnavailableIsExplained() {
        content(
            BillingUiState(
                shop = shop(),
                overview = BillingStateMapper.map(freeState()),
                storeUnavailable = true,
            ),
        )
        compose
            .onNodeWithText("Google Play şu an kullanılamıyor. Biraz sonra yeniden deneyin.")
            .performScrollTo()
            .assertIsDisplayed()
    }

    @Test
    @Config(qualifiers = "en")
    fun englishCopyHasParity() {
        content(BillingUiState(shop = shop(), overview = BillingStateMapper.map(freeState()), offers = listOf(monthly)))
        compose.onNodeWithText("Current plan").assertIsDisplayed()
        compose.onNodeWithText("Customers: 42 / 100").assertIsDisplayed()
        compose.onNodeWithText("Subscribe monthly · ₺49,99").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Restore purchases").performScrollTo().assertIsDisplayed()
    }

    private fun content(state: BillingUiState) {
        compose.setContent { CeteleTheme { BillingScreen(state, actions()) } }
    }

    private fun actions() =
        BillingActions(
            onSubscribe = { subscribed += it },
            onRestore = { restores++ },
            onManage = { manages++ },
            onReload = {},
            onDismissNotice = {},
            onBack = {},
        )
}
