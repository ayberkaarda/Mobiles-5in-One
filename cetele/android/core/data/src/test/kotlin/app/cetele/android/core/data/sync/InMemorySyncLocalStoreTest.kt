package app.cetele.android.core.data.sync

import app.cetele.android.core.data.database.entity.CustomerEntity
import app.cetele.android.core.data.database.entity.LedgerEntryEntity
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Test

class InMemorySyncLocalStoreTest : SyncLocalStoreContractTest() {
    override val store = InMemorySyncLocalStore()

    override suspend fun seed(row: OutboxRow) = store.seed(row)

    override suspend fun seed(row: CustomerEntity) = store.seed(row)

    override suspend fun seed(row: LedgerEntryEntity) = store.seed(row)

    override suspend fun customer(id: String): CustomerEntity? = store.customers[SyncFixtures.SHOP to id]

    override suspend fun entry(id: String): LedgerEntryEntity? = store.entries[SyncFixtures.SHOP to id]

    @Test fun sequenceAndResults() = runTest { sequenceAndResultsContract() }

    @Test fun rollbackAndPendingPayload() = runTest { rollbackAndPendingPayloadContract() }

    @Test fun photoAndReversal() = runTest { photoAndReversalContract() }
}
