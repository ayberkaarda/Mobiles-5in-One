package app.cetele.android.core.data.database

import android.app.Application
import app.cetele.android.core.data.repository.SearchNormalizer
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
class CustomerDaoTest {
    @Test fun isolationSearchTombstonesAndAggregateBalance() =
        runTest {
            val f = DataFixture()
            try {
                val dao = f.db.customerDao()
                dao.upsert(f.customer())
                dao.upsert(f.customer("customer-b", "shop-b"))
                dao.upsert(f.customer("deleted", deleted = DataFixture.NOW))
                f.db.ledgerEntryDao().insert(f.entry())
                f.db.ledgerEntryDao().insert(f.entry("payment", type = "PAYMENT", amount = 250))
                f.db.ledgerEntryDao().insert(f.entry("other", "shop-b", "customer-b", amount = 9900))
                assertEquals(listOf("customer-a"), dao.observeLive("shop-a", "ism").first().map { it.id })
                assertEquals(
                    emptyList<String>(),
                    dao.observeLive("shop-a", SearchNormalizer.query("%")).first().map { it.id },
                )
                assertEquals(
                    emptyList<String>(),
                    dao.observeLive("shop-a", SearchNormalizer.query("_sm")).first().map { it.id },
                )
                assertEquals(
                    750L,
                    dao
                        .observeBalances("shop-a")
                        .first()
                        .single()
                        .balanceMinor,
                )
                assertNull(dao.get("shop-b", "customer-a"))
                assertEquals(1, dao.countLive("shop-a"))
                dao.markDeleted("shop-a", "customer-a", DataFixture.NOW)
                assertEquals(0, dao.countLive("shop-a"))
                assertEquals(1, dao.countLive("shop-b"))
            } finally {
                f.close()
            }
        }
}
