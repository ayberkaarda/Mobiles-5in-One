package app.cetele.android.core.data.sync

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import app.cetele.android.core.data.database.CeteleDatabase
import app.cetele.android.core.data.database.DatabaseStore
import app.cetele.android.core.data.database.TestDatabase
import app.cetele.android.core.data.database.entity.CustomerEntity
import app.cetele.android.core.data.database.entity.LedgerEntryEntity
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class RoomSyncLocalStoreTest : SyncLocalStoreContractTest() {
    private lateinit var db: CeteleDatabase
    override lateinit var store: RoomSyncLocalStore

    @Before fun open() {
        db = TestDatabase.inMemory(ApplicationProvider.getApplicationContext<Context>())
        store = RoomSyncLocalStore(DatabaseStore({ db }, {}), SyncFixtures.clock, mockk(relaxed = true))
    }

    @After fun close() {
        db.close()
    }

    override suspend fun seed(row: OutboxRow) = db.outboxDao().insert(row)

    override suspend fun seed(row: CustomerEntity) = db.customerDao().upsert(row)

    override suspend fun seed(row: LedgerEntryEntity) = db.ledgerEntryDao().upsert(row)

    override suspend fun customer(id: String): CustomerEntity? = db.customerDao().get(SyncFixtures.SHOP, id)

    override suspend fun entry(id: String): LedgerEntryEntity? = db.ledgerEntryDao().get(SyncFixtures.SHOP, id)

    @Test fun sequenceAndResults() = runTest { sequenceAndResultsContract() }

    @Test fun rollbackAndPendingPayload() = runTest { rollbackAndPendingPayloadContract() }

    @Test fun photoAndReversal() = runTest { photoAndReversalContract() }
}
