package app.cetele.android.core.data.sync

import app.cetele.android.core.data.sync.SyncFixtures.SHOP
import app.cetele.android.core.data.sync.fake.FakeSyncServer
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.ProblemDetail
import app.cetele.android.core.network.api.SyncApi
import app.cetele.android.core.network.dto.EntryType
import app.cetele.android.core.network.dto.OperationStatus
import app.cetele.android.core.network.dto.problem.ProblemFieldError
import app.cetele.android.core.network.dto.sync.EntryInput
import app.cetele.android.core.network.dto.sync.OperationResult
import app.cetele.android.core.network.dto.sync.PullResponse
import app.cetele.android.core.network.dto.sync.PushRequest
import app.cetele.android.core.network.dto.sync.PushResponse
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Test

class RejectionHandlingTest {
    @Test fun everyOperationRejectionIsTerminalAndUndoesEntryAndReversal() =
        runTest {
            val codes =
                listOf(
                    "forbidden",
                    "not_found",
                    "conflict",
                    "validation.failed",
                    "customer.deleted",
                    "ledger.already_reversed",
                    "ledger.reversal_mismatch",
                    "plan.customer_limit",
                )
            for (code in codes) {
                val store = InMemorySyncLocalStore()
                store.seed(
                    SyncFixtures
                        .entryEntity(
                            EntryInput("original", "c", EntryType.DEBT, 100, SyncFixtures.today),
                        ).copy(syncState = "SYNCED"),
                )
                SyncFixtures.entry(
                    store,
                    "operation",
                    EntryInput("reversal", "c", EntryType.DEBT, 100, SyncFixtures.today, reverses = "original"),
                )
                store.applyResults(
                    SHOP,
                    listOf(
                        OperationResult(
                            "operation",
                            OperationStatus.REJECTED,
                            code = code,
                            errors = listOf(ProblemFieldError("entry.amountMinor", "out_of_range")),
                        ),
                    ),
                    0,
                )
                assertFalse(store.entries.containsKey(SHOP to "reversal"), code)
                assertEquals(null, store.entries.getValue(SHOP to "original").reversedBy, code)
                assertEquals("REJECTED", store.operations.getValue(SHOP to "operation").state, code)
                assertEquals(code, store.operations.getValue(SHOP to "operation").lastCode)
                assertNotNull(store.operations.getValue(SHOP to "operation").errorsJson)
                assertEquals(emptyList<OutboxRow>(), store.queuedOperations(SHOP, 500))
            }
        }

    @Test fun neverAcknowledgedCustomerIsRemovedButAcknowledgedEditIsRestoredOnPull() =
        runTest {
            val server = FakeSyncServer(customerLimit = 1)
            val store = InMemorySyncLocalStore()
            val engine = SyncFixtures.engine(store, server.client("owner"))
            SyncFixtures.customer(store, "first", "c1", "Birinci")
            engine.sync(SHOP)
            SyncFixtures.customer(store, "over-limit", "c2", "İkinci", 1)
            engine.sync(SHOP)
            assertFalse(store.customers.containsKey(SHOP to "c2"))
            assertEquals("plan.customer_limit", store.operations.getValue(SHOP to "over-limit").lastCode)
            SyncFixtures.customer(store, "edit", "c1", "Düzenleme", 2)
            store.applyResults(
                SHOP,
                listOf(OperationResult("edit", OperationStatus.REJECTED, code = "forbidden")),
                server.head(SHOP),
            )
            assertNotNull(store.customers[SHOP to "c1"])
            assertEquals(0L, store.cursor(SHOP).lastPulledSeq)
            PullApplier(store, server.client("owner")).pull(SHOP)
            assertEquals("Birinci", store.customers.getValue(SHOP to "c1").name)
        }

    @Test fun customerRejectionsRemoveOnlyUnacknowledgedLocalRows() =
        runTest {
            for (code in listOf(
                "forbidden",
                "not_found",
                "conflict",
                "validation.failed",
                "customer.deleted",
                "plan.customer_limit",
            )) {
                val store = InMemorySyncLocalStore()
                SyncFixtures.customer(store, "operation", "customer", "Müşteri")
                store.applyResults(SHOP, listOf(OperationResult("operation", OperationStatus.REJECTED, code = code)), 0)
                assertFalse(store.customers.containsKey(SHOP to "customer"), code)
                assertEquals(code, store.operations.getValue(SHOP to "operation").lastCode)
            }
        }

    @Test fun invalidWholeBatchIsBlockedAndNeverResent() =
        runTest {
            val store = InMemorySyncLocalStore()
            var pushes = 0
            val api =
                object : SyncApi {
                    override suspend fun push(
                        shopId: String,
                        body: PushRequest,
                    ): ApiResult<PushResponse> {
                        pushes++
                        return ApiResult.Failure.Problem(
                            ProblemDetail(title = "Invalid batch", status = 422, code = "validation.failed"),
                        )
                    }

                    override suspend fun pull(
                        shopId: String,
                        since: Long,
                        limit: Int,
                    ): ApiResult<PullResponse> = ApiResult.Success(PullResponse(emptyList(), since, false), 200)
                }
            SyncFixtures.customer(store, "invalid", "c", "Müşteri")
            val engine = SyncFixtures.engine(store, api)
            assertEquals(SyncOutcome.Blocked("validation.failed"), engine.sync(SHOP))
            engine.sync(SHOP)
            assertEquals(1, pushes)
            assertEquals("BLOCKED", store.operations.getValue(SHOP to "invalid").state)
            assertEquals("validation.failed", store.operations.getValue(SHOP to "invalid").lastCode)
            assertNotNull(store.customers[SHOP to "c"])
        }
}
