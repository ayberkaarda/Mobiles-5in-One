package app.cetele.android.core.data.write

import android.app.Application
import androidx.room.useWriterConnection
import app.cetele.android.core.data.database.DataFixture
import app.cetele.android.core.data.media.CompressedPhoto
import app.cetele.android.core.domain.model.ConsentSource
import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.core.domain.validation.FieldError
import app.cetele.android.core.network.NetworkJson
import app.cetele.android.core.network.dto.sync.CustomerInput
import app.cetele.android.core.network.dto.sync.EntryInput
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.decodeFromString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class)
class LocalWriteServiceTest {
    private val today = LocalDate.parse("2026-10-06")

    @Test fun customerAndCapturedPayloadAreAtomic() =
        runTest {
            val f = DataFixture()
            try {
                val saved = f.writes.upsertCustomer("shop-a", CustomerDraft(name = " İsmail ")) as WriteResult.Ok
                val row = f.db.customerDao().get("shop-a", saved.id)!!
                val outbox =
                    f.db
                        .outboxDao()
                        .queued("shop-a", 10)
                        .single()
                assertEquals("ismail", row.searchKey)
                assertEquals("PENDING", row.syncState)
                assertNull(outbox.clientSeq)
                assertEquals("İsmail", NetworkJson.decodeFromString<CustomerInput>(outbox.payloadJson).name)
                f.db.customerDao().upsert(row.copy(name = "Server edit"))
                assertEquals(
                    "İsmail",
                    NetworkJson
                        .decodeFromString<CustomerInput>(
                            f.db
                                .outboxDao()
                                .get("shop-a", outbox.clientId)!!
                                .payloadJson,
                        ).name,
                )
            } finally {
                f.close()
            }
        }

    @Test fun failedOutboxInsertRollsBackCustomer() =
        runTest {
            val f = DataFixture()
            try {
                f.db.useWriterConnection { connection ->
                    connection.usePrepared(
                        "CREATE TRIGGER reject_outbox BEFORE INSERT ON outbox_operations " +
                            "BEGIN SELECT RAISE(ABORT, 'rejected'); END",
                    ) {
                        it.step()
                    }
                }
                assertTrue(runCatching { f.writes.upsertCustomer("shop-a", CustomerDraft(name = "Valid")) }.isFailure)
                assertEquals(0, f.db.customerDao().countLive("shop-a"))
                assertEquals(0, f.db.outboxDao().countPending("shop-a"))
            } finally {
                f.close()
            }
        }

    @Test fun customerNegativeConstraintsWriteNothing() =
        runTest {
            val f = DataFixture()
            try {
                val base = CustomerDraft(name = "Valid")
                val cases =
                    listOf(
                        base.copy(name = " ") to FieldError("customer.name", "required"),
                        base.copy(name = "n".repeat(81)) to FieldError("customer.name", "too_long"),
                        base.copy(phone = "123") to FieldError("customer.phone", "invalid_format"),
                        base.copy(note = "n".repeat(501)) to FieldError("customer.note", "too_long"),
                        base.copy(tag = "") to FieldError("customer.tag", "required"),
                        base.copy(tag = "t".repeat(31)) to FieldError("customer.tag", "too_long"),
                        base.copy(smsConsent = true, smsConsentSource = ConsentSource.IN_PERSON) to
                            FieldError("customer.smsConsentAt", "required"),
                        base.copy(smsConsent = true, smsConsentAt = f.clock.instant()) to
                            FieldError("customer.smsConsentSource", "required"),
                    )
                for ((draft, error) in cases) {
                    assertTrue(
                        (f.writes.upsertCustomer("shop-a", draft) as WriteResult.Invalid).errors.contains(error),
                    )
                }
                assertEquals(0, f.db.customerDao().countLive("shop-a"))
                assertEquals(0, f.db.outboxDao().countPending("shop-a"))
            } finally {
                f.close()
            }
        }

    @Test fun entryNegativeConstraintsWriteNothing() =
        runTest {
            val f = DataFixture()
            try {
                f.db.customerDao().upsert(f.customer())
                val base = EntryDraft("customer-a", EntryType.DEBT, 1000, today)
                val cases =
                    listOf(
                        base.copy(amountMinor = 0) to FieldError("entry.amountMinor", "out_of_range"),
                        base.copy(amountMinor = 10000000001) to FieldError("entry.amountMinor", "out_of_range"),
                        base.copy(occurredOn = today.plusDays(2)) to FieldError("entry.occurredOn", "out_of_range"),
                        base.copy(type = EntryType.PAYMENT, dueOn = today) to
                            FieldError("entry.dueOn", "invalid_format"),
                        base.copy(note = "n".repeat(501)) to FieldError("entry.note", "too_long"),
                        base.copy(
                            photoKey = "media/shop-b/photo.jpg",
                        ) to FieldError("entry.photoKey", "invalid_format"),
                    )
                for ((draft, error) in cases) {
                    assertTrue(
                        (f.writes.createEntry("shop-a", draft) as WriteResult.Invalid).errors.contains(error),
                    )
                }
                assertTrue(
                    f.db
                        .ledgerEntryDao()
                        .all("shop-a")
                        .isEmpty(),
                )
                assertEquals(0, f.db.outboxDao().countPending("shop-a"))
            } finally {
                f.close()
            }
        }

    @Test fun photoBlocksEntryAndReversalDependsOnOriginal() =
        runTest {
            val f = DataFixture()
            try {
                f.db.customerDao().upsert(f.customer())
                val original =
                    f.writes.createEntry(
                        "shop-a",
                        EntryDraft("customer-a", EntryType.DEBT, 1250, today),
                        CompressedPhoto(byteArrayOf(1, 2), 10, 10),
                    ) as WriteResult.Ok
                val row =
                    f.db
                        .outboxDao()
                        .forEntity("shop-a", original.id)
                        .single()
                assertEquals("BLOCKED", row.state)
                assertEquals(original.id, row.photoEntryId)
                assertEquals(
                    2,
                    f.db
                        .pendingPhotoDao()
                        .get("shop-a", original.id)
                        ?.contentLength,
                )
                val reversal = f.writes.reverseEntry("shop-a", original.id, today) as WriteResult.Ok
                assertEquals(
                    reversal.id,
                    f.db
                        .ledgerEntryDao()
                        .get("shop-a", original.id)
                        ?.reversedBy,
                )
                val correction =
                    f.db
                        .outboxDao()
                        .forEntity("shop-a", reversal.id)
                        .single()
                assertEquals(row.clientId, correction.dependsOnClientId)
                val input = NetworkJson.decodeFromString<EntryInput>(correction.payloadJson)
                assertEquals(original.id, input.reverses)
                assertNull(input.dueOn)
                assertNull(input.photoKey)
                assertTrue(f.writes.reverseEntry("shop-a", original.id, today) is WriteResult.Invalid)
                assertTrue(f.writes.reverseEntry("shop-a", reversal.id, today) is WriteResult.Invalid)
                assertEquals(
                    2,
                    f.db
                        .ledgerEntryDao()
                        .all("shop-a")
                        .size,
                )
            } finally {
                f.close()
            }
        }

    @Test fun missingDeletedOrForeignCustomersAndInvalidPhotoWriteNothing() =
        runTest {
            val f = DataFixture()
            try {
                f.db.customerDao().upsert(f.customer("deleted", deleted = DataFixture.NOW))
                f.db.customerDao().upsert(f.customer("foreign", "shop-b"))
                val base = EntryDraft("missing", EntryType.DEBT, 100, today)
                for (id in listOf("missing", "deleted", "foreign")) {
                    val result = f.writes.createEntry("shop-a", base.copy(customerId = id)) as WriteResult.Invalid
                    assertTrue(result.errors.contains(FieldError("entry.customerId", "customer.deleted")))
                }
                f.db.customerDao().upsert(f.customer())
                val draft = base.copy(customerId = "customer-a")
                val invalidPhotos =
                    listOf(
                        CompressedPhoto(ByteArray(0), 10, 10),
                        CompressedPhoto(ByteArray(1200001), 10, 10),
                        CompressedPhoto(byteArrayOf(1), 1601, 10),
                        CompressedPhoto(byteArrayOf(1), 10, 0),
                    )
                for (photo in invalidPhotos) {
                    val result = f.writes.createEntry("shop-a", draft, photo) as WriteResult.Invalid
                    assertTrue(result.errors.contains(FieldError("entry.photoKey", "out_of_range")))
                }
                assertTrue(
                    f.db
                        .ledgerEntryDao()
                        .all("shop-a")
                        .isEmpty(),
                )
                assertTrue(
                    f.db
                        .pendingPhotoDao()
                        .pending("shop-a")
                        .isEmpty(),
                )
                assertEquals(0, f.db.outboxDao().countPending("shop-a"))
            } finally {
                f.close()
            }
        }
}
