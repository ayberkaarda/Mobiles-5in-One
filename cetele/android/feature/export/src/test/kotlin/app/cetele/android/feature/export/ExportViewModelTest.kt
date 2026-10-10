package app.cetele.android.feature.export

import android.content.Context
import androidx.lifecycle.ViewModelStore
import app.cetele.android.core.data.repository.CustomerRepository
import app.cetele.android.core.data.repository.LedgerRepository
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.network.api.StatementsApi
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
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
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.time.Clock
import java.time.ZoneOffset

@OptIn(ExperimentalCoroutinesApi::class)
class ExportViewModelTest {
    @TempDir
    lateinit var cache: Path
    private val dispatcher = StandardTestDispatcher()
    private val store = ViewModelStore()
    private val shops = mockk<ShopRepository>()
    private val customers = mockk<CustomerRepository>()
    private val ledger = mockk<LedgerRepository>()
    private val statements = mockk<StatementsApi>()
    private val active = MutableStateFlow<Shop?>(shop)

    @BeforeEach
    fun setup() {
        Dispatchers.setMain(dispatcher)
        every { shops.observeActive() } returns active
    }

    @AfterEach
    fun cleanup() {
        store.clear()
        Dispatchers.resetMain()
    }

    @Test
    fun staffCannotReadOrWriteAnAllEntriesExport() =
        runTest(dispatcher) {
            active.value = shop.copy(role = ShopRole.STAFF)
            val model = model()
            model.openAll()
            advanceUntilIdle()
            model.share()
            advanceUntilIdle()
            verify(exactly = 0) { ledger.observeAll(any()) }
            verify(exactly = 0) { customers.observeList(any(), any()) }
            assertFalse(model.snapshot.value.available)
            assertFalse(cache.resolve("exports").toFile().exists())
        }

    @Test
    fun allEntriesIncludesTombstonedCustomerAndCorrectionLinks() =
        runTest(dispatcher) {
            every { customers.observeList(shop.id, "") } returns flowOf(emptyList())
            every { customers.observe(shop.id, customer.id) } returns flowOf(customer.copy(deletedAt = instant))
            every { ledger.observeAll(shop.id) } returns
                flowOf(listOf(entry(reversedBy = "correction"), entry(id = "correction", reverses = "entry-1")))
            val model = model()
            model.openAll()
            advanceUntilIdle()
            val data = model.snapshot.value
            assertTrue(data.available)
            assertEquals(2, data.csvRows.size)
            assertTrue(data.csvRows.all { it.customer.deletedAt == instant })
            assertEquals(setOf("entry-1", "correction"), data.csvRows.map { it.statement.entry.id }.toSet())
        }

    @Test
    fun losingOwnerRoleClearsPreviouslyLoadedCsvRows() =
        runTest(dispatcher) {
            every { customers.observeList(shop.id, "") } returns flowOf(emptyList())
            every { ledger.observeAll(shop.id) } returns flowOf(emptyList())
            val model = model()
            model.openAll()
            advanceUntilIdle()
            assertTrue(model.snapshot.value.available)
            active.value = shop.copy(role = ShopRole.STAFF)
            advanceUntilIdle()
            assertFalse(model.snapshot.value.available)
            assertEquals(emptyList<Any>(), model.snapshot.value.csvRows)
        }

    private fun model(): ExportViewModel {
        val context = mockk<Context>()
        every { context.cacheDir } returns cache.toFile()
        return ExportViewModel(context, shops, customers, ledger, statements, Clock.fixed(instant, ZoneOffset.UTC))
            .also { store.put("export", it) }
    }
}
