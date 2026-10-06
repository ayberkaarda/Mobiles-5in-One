package app.cetele.android.core.data.database

import android.app.Application
import app.cetele.android.core.data.repository.RoomDashboardRepository
import app.cetele.android.core.data.repository.asModel
import app.cetele.android.core.domain.ledger.DashboardSummary
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class)
class DashboardDaoTest {
    @Test fun sqlSummaryEqualsDomainIncludingReversalsDeletedAndCreditCustomers() =
        runTest {
            val f = DataFixture()
            try {
                val customers =
                    listOf(
                        f.customer(),
                        f.customer("credit", name = "Ali"),
                        f.customer("deleted", deleted = DataFixture.NOW),
                        f.customer("foreign", "shop-b"),
                    )
                customers.forEach { f.db.customerDao().upsert(it) }
                val entries =
                    listOf(
                        f.entry(due = "2026-10-06"),
                        f.entry("payment", type = "PAYMENT", amount = 200),
                        f.entry("credit-payment", customer = "credit", type = "PAYMENT", amount = 800),
                        f.entry("reversed", reversedBy = "correction", amount = 9000),
                        f.entry("correction", reverses = "reversed", amount = 9000),
                        f.entry("deleted-debt", customer = "deleted", amount = 50000),
                        f.entry("foreign-debt", "shop-b", "foreign", amount = 70000),
                    )
                entries.forEach { f.db.ledgerEntryDao().insert(it) }
                val today = LocalDate.parse("2026-10-06")
                val expected =
                    DashboardSummary.compute(
                        customers.filter { it.shopId == "shop-a" }.map { it.asModel() },
                        entries
                            .filter {
                                it.shopId ==
                                    "shop-a"
                            }.map { it.asModel() },
                        today,
                    )
                assertEquals(expected, RoomDashboardRepository(f.databases).observe("shop-a", today).first())
                assertEquals(800L, expected.totalReceivable.minor)
                assertEquals(1, expected.dueToday.size)
            } finally {
                f.close()
            }
        }
}
