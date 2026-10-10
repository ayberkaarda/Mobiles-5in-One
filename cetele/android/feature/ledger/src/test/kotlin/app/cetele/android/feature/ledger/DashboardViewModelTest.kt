package app.cetele.android.feature.ledger

import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.repository.DashboardRepository
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.domain.ledger.DashboardSummary
import app.cetele.android.core.domain.ledger.DebtorLine
import app.cetele.android.core.domain.ledger.DueLine
import app.cetele.android.core.domain.model.Money
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.feature.ledger.dashboard.DashboardViewModel
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DashboardViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val dashboard = mockk<DashboardRepository>()
    private val shops = mockk<ShopRepository>()
    private val active = MutableStateFlow<Shop?>(LedgerFixtures.shop())
    private val firstSummary =
        DashboardSummary(
            Money(1250),
            Money(200),
            Money(1050),
            listOf(DebtorLine("customer-a", "Ayşe", Money(1050))),
            listOf(DueLine(LedgerFixtures.entry().copy(dueOn = LedgerFixtures.today), "Ayşe", Money(1050))),
        )
    private val summaries = MutableStateFlow(firstSummary)
    private lateinit var model: DashboardViewModel

    @BeforeEach
    fun prepare() {
        Dispatchers.setMain(dispatcher)
        every { shops.observeActive() } returns active
        every { dashboard.observe("shop-a", LedgerFixtures.today) } returns summaries
        model = DashboardViewModel(dashboard, shops, LedgerFixtures.clock)
    }

    @AfterEach
    fun finish() {
        model.viewModelScope.cancel()
        Dispatchers.resetMain()
    }

    @Test
    fun summaryContainsTodayAmountsDebtorsAndDueEntriesAndUpdatesLive() =
        modelTest {
            runCurrent()
            assertEquals("shop-a", model.state.value.shopId)
            assertEquals(firstSummary, model.state.value.summary)
            assertFalse(model.state.value.loading)
            assertEquals(
                1250L,
                model.state.value.summary
                    ?.todayDebt
                    ?.minor,
            )
            assertEquals(
                "customer-a",
                model.state.value.summary
                    ?.dueToday
                    ?.single()
                    ?.entry
                    ?.customerId,
            )
            summaries.value = firstSummary.copy(totalReceivable = Money(850))
            runCurrent()
            assertEquals(
                850L,
                model.state.value.summary
                    ?.totalReceivable
                    ?.minor,
            )
        }

    @Test
    fun switchingShopReplacesTheOldSummaryAndRefreshTargetsTheCurrentShop() =
        modelTest {
            runCurrent()
            val second =
                firstSummary.copy(
                    topDebtors = emptyList(),
                    dueToday = emptyList(),
                    totalReceivable = Money.ZERO,
                )
            every { dashboard.observe("shop-b", LedgerFixtures.today) } returns MutableStateFlow(second)
            active.value = LedgerFixtures.shop("shop-b")
            runCurrent()
            assertEquals(second, model.state.value.summary)
            model.refresh()
            assertEquals("shop-b", model.refreshes.first())
            summaries.value = firstSummary.copy(totalReceivable = Money(9999))
            runCurrent()
            assertEquals(second, model.state.value.summary)
            verify(exactly = 1) { dashboard.observe("shop-b", LedgerFixtures.today) }
        }

    @Test
    fun losingTheActiveShopClearsTheDashboard() =
        modelTest {
            runCurrent()
            active.value = null
            runCurrent()
            assertNull(model.state.value.shopId)
            assertNull(model.state.value.summary)
            assertFalse(model.state.value.loading)
        }

    private fun modelTest(block: suspend TestScope.() -> Unit) =
        runTest(dispatcher) {
            try {
                block()
            } finally {
                model.viewModelScope.cancel()
            }
        }
}
