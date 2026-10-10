package app.cetele.android.core.data.sync.fake

import app.cetele.android.core.data.sync.SyncFixtures
import app.cetele.android.core.data.sync.SyncFixtures.SHOP
import app.cetele.android.core.network.dto.EntryType
import app.cetele.android.core.network.dto.OperationStatus
import app.cetele.android.core.network.dto.SyncKind
import app.cetele.android.core.network.dto.sync.CustomerInput
import app.cetele.android.core.network.dto.sync.EntryInput
import app.cetele.android.core.network.dto.sync.PushRequest
import app.cetele.android.core.network.dto.sync.SyncOperation
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class FakeSyncServerTest {
    @Test fun wholeBatchValidationHasNoEffects() =
        runTest {
            val server = FakeSyncServer()
            val api = server.client("owner")
            val first =
                SyncOperation(
                    "first",
                    1,
                    SyncKind.CUSTOMER_UPSERT,
                    customer = CustomerInput("c1", "Müşteri", smsConsent = false),
                )
            val invalid =
                listOf(
                    listOf(first, first.copy(clientId = "second", clientSeq = 1)),
                    listOf(first, first.copy(clientSeq = 2)),
                    listOf(first.copy(customer = null)),
                    (1L..501L).map { first.copy(clientId = "operation-$it", clientSeq = it) },
                    listOf(first.copy(clientSeq = 0)),
                )
            invalid.forEach { operations ->
                assertEquals("validation.failed", api.push(SHOP, PushRequest(operations)).problemCode)
                assertTrue(server.customers.isEmpty())
                assertEquals(0L, server.head(SHOP))
            }
        }

    @Test fun operationRulesRejectIndividuallyAndNeighboursApply() =
        runTest {
            val server = FakeSyncServer(customerLimit = 2)
            val api = server.client("owner")
            var seq = 0L

            suspend fun send(
                kind: SyncKind,
                customer: CustomerInput? = null,
                entry: EntryInput? = null,
                customerId: String? = null,
            ): app.cetele.android.core.network.dto.sync.OperationResult {
                seq++
                return api
                    .push(
                        SHOP,
                        PushRequest(listOf(SyncOperation("operation-$seq", seq, kind, customer, customerId, entry))),
                    ).getOrNull()!!
                    .results
                    .single()
            }
            val input = CustomerInput("c1", "Müşteri", smsConsent = false)
            assertEquals(OperationStatus.APPLIED, send(SyncKind.CUSTOMER_UPSERT, customer = input).status)
            val debt = EntryInput("debt", "c1", EntryType.DEBT, 100, SyncFixtures.today)
            assertEquals("not_found", send(SyncKind.ENTRY_CREATE, entry = debt.copy(customerId = "missing")).code)
            assertEquals("validation.failed", send(SyncKind.ENTRY_CREATE, entry = debt.copy(amountMinor = 0)).code)
            assertEquals(OperationStatus.APPLIED, send(SyncKind.ENTRY_CREATE, entry = debt).status)
            assertEquals("conflict", send(SyncKind.ENTRY_CREATE, entry = debt).code)
            val reversal = debt.copy(id = "reversal", reverses = debt.id)
            assertEquals(
                "ledger.reversal_mismatch",
                send(SyncKind.ENTRY_CREATE, entry = reversal.copy(amountMinor = 101)).code,
            )
            assertEquals(OperationStatus.APPLIED, send(SyncKind.ENTRY_CREATE, entry = reversal).status)
            assertEquals(
                "ledger.already_reversed",
                send(SyncKind.ENTRY_CREATE, entry = reversal.copy(id = "again")).code,
            )
            assertEquals(
                OperationStatus.APPLIED,
                send(SyncKind.CUSTOMER_UPSERT, customer = input.copy(id = "c2")).status,
            )
            assertEquals("plan.customer_limit", send(SyncKind.CUSTOMER_UPSERT, customer = input.copy(id = "c3")).code)
            assertEquals(OperationStatus.APPLIED, send(SyncKind.CUSTOMER_DELETE, customerId = "c1").status)
            assertEquals("customer.deleted", send(SyncKind.CUSTOMER_UPSERT, customer = input).code)
            assertEquals("customer.deleted", send(SyncKind.ENTRY_CREATE, entry = debt.copy(id = "deleted-entry")).code)
            val staff = server.client("staff", FakeSyncServer.Role.STAFF)
            val batch =
                PushRequest(
                    listOf(
                        SyncOperation("staff-delete", 1, SyncKind.CUSTOMER_DELETE, customerId = "c2"),
                        SyncOperation(
                            "staff-write",
                            2,
                            SyncKind.ENTRY_CREATE,
                            entry = debt.copy(id = "neighbour", customerId = "c2"),
                        ),
                    ),
                )
            val results = staff.push(SHOP, batch).getOrNull()!!.results
            assertEquals("forbidden", results.first().code)
            assertEquals(OperationStatus.APPLIED, results.last().status)
            assertFalse(server.customers.getValue(SHOP to "c2").deletedAt != null)
        }

    @Test fun receiptsAndChangeSequencesAreScopedToShop() =
        runTest {
            val server = FakeSyncServer()
            val api = server.client("owner")
            val body =
                PushRequest(
                    listOf(
                        SyncOperation(
                            "same-client",
                            1,
                            SyncKind.CUSTOMER_UPSERT,
                            customer = CustomerInput("same-id", "Müşteri", smsConsent = false),
                        ),
                    ),
                )
            assertEquals(
                OperationStatus.APPLIED,
                api
                    .push(SHOP, body)
                    .getOrNull()!!
                    .results
                    .single()
                    .status,
            )
            assertEquals(
                OperationStatus.DUPLICATE,
                api
                    .push(SHOP, body)
                    .getOrNull()!!
                    .results
                    .single()
                    .status,
            )
            assertEquals(
                OperationStatus.APPLIED,
                api
                    .push("other-shop", body)
                    .getOrNull()!!
                    .results
                    .single()
                    .status,
            )
            assertEquals(1L, server.head(SHOP))
            assertEquals(1L, server.head("other-shop"))
            assertEquals(
                1,
                api
                    .pull(SHOP, 0, 2)
                    .getOrNull()!!
                    .changes.size,
            )
        }
}
