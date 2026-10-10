package app.cetele.android.core.data.database

import android.app.Application
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class)
class LedgerEntryDaoTest {
    @Test fun orderReversalAndTenantBoundUpdates() =
        runTest {
            val f = DataFixture()
            try {
                val dao = f.db.ledgerEntryDao()
                dao.insert(f.entry("later"))
                dao.insert(f.entry("earlier").copy(occurredOn = "2026-10-05"))
                dao.insert(f.entry("foreign", "shop-b"))
                assertEquals(
                    listOf("earlier", "later"),
                    dao.observeForCustomer("shop-a", "customer-a").first().map { it.id },
                )
                dao.setReversedBy("shop-b", "later", "correction")
                assertNull(dao.get("shop-a", "later")?.reversedBy)
                dao.setReversedBy("shop-a", "later", "correction")
                assertEquals("correction", dao.get("shop-a", "later")?.reversedBy)
                dao.delete("shop-a", "foreign")
                assertEquals("foreign", dao.get("shop-b", "foreign")?.id)
                assertEquals(2, dao.balanceLines("shop-a", "customer-a").size)
            } finally {
                f.close()
            }
        }
}
