package app.cetele.android.feature.customers

import androidx.lifecycle.SavedStateHandle
import app.cetele.android.core.data.repository.CustomerRepository
import app.cetele.android.core.data.repository.LedgerRepository
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.data.write.WriteResult
import app.cetele.android.core.domain.model.Customer
import app.cetele.android.core.domain.model.Money
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.feature.customers.detail.CustomerDetailViewModel
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
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
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CustomerDetailViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val customers = mockk<CustomerRepository>()
    private val shops = mockk<ShopRepository>()
    private val ledger = mockk<LedgerRepository>()
    private val active = MutableStateFlow<Shop?>(sampleShop())

    @BeforeEach
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        every { shops.observeActive() } returns active
        every { customers.observe("shop-one", "customer-one") } returns MutableStateFlow<Customer?>(sampleCustomer())
        every { customers.observeBalance("shop-one", "customer-one") } returns MutableStateFlow(Money(125000))
        every { ledger.observeEntries("shop-one", "customer-one") } returns MutableStateFlow(listOf(sampleEntry()))
    }

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    private fun model() =
        CustomerDetailViewModel(
            SavedStateHandle(mapOf("customerId" to "customer-one")),
            customers,
            shops,
            ledger,
        )

    @Test
    fun ownerDeletionUsesRepositoryAndPublishesCompletionOnce() =
        runTest(dispatcher) {
            coEvery { customers.delete("shop-one", "customer-one") } returns WriteResult.Ok("customer-one")
            val model = model()
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { model.state.collect() }
            advanceUntilIdle()
            assertEquals(125000L, model.state.value.balance.minor)
            assertEquals(
                "entry-one",
                model.state.value.rows
                    .single()
                    .entry.id,
            )
            model.delete()
            model.delete()
            advanceUntilIdle()
            assertTrue(model.state.value.deleted)
            assertFalse(model.state.value.deleting)
            coVerify(exactly = 1) { customers.delete("shop-one", "customer-one") }
        }

    @Test
    fun staffCannotDeleteEvenThroughDirectCall() =
        runTest(dispatcher) {
            active.value = sampleShop(role = ShopRole.STAFF)
            val model = model()
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { model.state.collect() }
            advanceUntilIdle()
            model.delete()
            advanceUntilIdle()
            coVerify(exactly = 0) { customers.delete(any(), any()) }
            assertFalse(model.state.value.deleted)
        }

    @Test
    fun ownershipLostBeforeWriteRefusesDeletion() =
        runTest(dispatcher) {
            val model = model()
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { model.state.collect() }
            advanceUntilIdle()
            model.delete()
            active.value = sampleShop(role = ShopRole.STAFF)
            advanceUntilIdle()
            coVerify(exactly = 0) { customers.delete(any(), any()) }
            assertEquals("forbidden", model.state.value.problemCode)
            assertFalse(model.state.value.deleting)
        }
}
