package app.cetele.android.feature.customers

import app.cetele.android.core.data.repository.CustomerListItem
import app.cetele.android.core.data.repository.CustomerRepository
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.domain.model.Money
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.feature.customers.list.CustomerListViewModel
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CustomerListViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val shops = mockk<ShopRepository>()
    private val customers = mockk<CustomerRepository>()
    private val active = MutableStateFlow<Shop?>(sampleShop())

    @BeforeEach
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        every { shops.observeActive() } returns active
    }

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun searchUsesTurkishNormalizationAndReturnsMatchingRows() =
        runTest(dispatcher) {
            val rows = listOf(CustomerListItem(sampleCustomer(), Money(125000)))
            every { customers.observeList("shop-one", "") } returns
                MutableStateFlow(
                    rows + CustomerListItem(sampleCustomer("another", "Örnek müşteri"), Money.ZERO),
                )
            every { customers.observeList("shop-one", "isık sen") } returns MutableStateFlow(rows)
            val model = CustomerListViewModel(shops, customers)
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { model.state.collect() }
            advanceUntilIdle()
            model.search("  İŞIK   ŞEN  ")
            advanceUntilIdle()
            verify { customers.observeList("shop-one", "isık sen") }
            assertEquals("  İŞIK   ŞEN  ", model.state.value.query)
            assertEquals(rows, model.state.value.customers)
        }

    @Test
    fun balanceUpdatesKeepDebtPaymentAndZeroAsMinorUnits() =
        runTest(dispatcher) {
            val rows =
                MutableStateFlow(
                    listOf(
                        CustomerListItem(sampleCustomer("debt"), Money(125000)),
                        CustomerListItem(sampleCustomer("payment"), Money(-1200)),
                        CustomerListItem(sampleCustomer("zero"), Money.ZERO),
                    ),
                )
            every { customers.observeList("shop-one", "") } returns rows
            val model = CustomerListViewModel(shops, customers)
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { model.state.collect() }
            advanceUntilIdle()
            assertEquals(
                listOf(125000L, -1200L, 0L),
                model.state.value.customers
                    .map { it.balance.minor },
            )
            rows.value = listOf(rows.value.first().copy(balance = Money(500)))
            advanceUntilIdle()
            assertEquals(
                500L,
                model.state.value.customers
                    .single()
                    .balance.minor,
            )
        }

    @Test
    fun changingShopAndSigningOutClearPreviousRows() =
        runTest(dispatcher) {
            every { customers.observeList("shop-one", "") } returns
                MutableStateFlow(listOf(CustomerListItem(sampleCustomer(), Money(100))))
            every { customers.observeList("shop-two", "") } returns MutableStateFlow(emptyList())
            val model = CustomerListViewModel(shops, customers)
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { model.state.collect() }
            advanceUntilIdle()
            active.value = sampleShop("shop-two")
            advanceUntilIdle()
            assertEquals(
                "shop-two",
                model.state.value.shop
                    ?.id,
            )
            assertEquals(emptyList<CustomerListItem>(), model.state.value.customers)
            active.value = null
            advanceUntilIdle()
            assertEquals(null, model.state.value.shop)
            assertFalse(model.state.value.loading)
        }
}
