package app.cetele.android.core.data.backup

import android.app.Application
import app.cetele.android.core.data.database.DataFixture
import app.cetele.android.core.data.database.entity.CustomerEntity
import app.cetele.android.core.data.database.entity.LedgerEntryEntity
import app.cetele.android.core.data.database.entity.ShopEntity
import app.cetele.android.core.data.write.LocalWriteEvents
import app.cetele.android.core.network.NetworkJson
import app.cetele.android.core.network.dto.sync.EntryInput
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class)
class BackupServiceTest {
    private val passphrase = "Çetele yedeği 2026"

    @Test fun exportAndImportRoundTripRestoresRowsLinksPhotoKeysAndPendingWork() =
        runTest {
            val source = Device()
            val target = Device()
            try {
                source.seed()
                val exported = source.service.export(SHOP, passphrase.toCharArray()) as BackupExportResult.Ok
                assertEquals(2, exported.customers)
                assertEquals(4, exported.entries)
                target.shop()
                val preview =
                    (
                        target.service.open(
                            exported.bytes,
                            passphrase.toCharArray(),
                        ) as BackupOpenResult.Ok
                    ).preview
                assertEquals(SHOP, preview.shopId)
                assertEquals("Çınar Bakkalı", preview.shopName)
                assertEquals(2, preview.customers)
                assertEquals(4, preview.entries)
                assertEquals(2, preview.newCustomers)
                assertEquals(4, preview.newEntries)
                assertEquals(
                    0,
                    target.fixture.db
                        .customerDao()
                        .countLive(SHOP),
                )
                assertEquals(BackupMergeResult.Ok(2, 4), target.service.merge(preview))
                assertEquals(source.customers(), target.customers())
                assertEquals(source.entries(), target.entries())
                assertEquals(
                    "photos/shop/entry.jpg",
                    target.fixture.db
                        .ledgerEntryDao()
                        .get(SHOP, ORIGINAL)!!
                        .photoKey,
                )
                val queued =
                    target.fixture.db
                        .outboxDao()
                        .queued(SHOP, 50)
                assertEquals(listOf("CUSTOMER_UPSERT", "CUSTOMER_DELETE", "ENTRY_CREATE"), queued.map { it.kind })
                assertEquals(PENDING_ENTRY, queued.last().entityId)
                assertEquals(
                    PENDING_ENTRY,
                    NetworkJson.decodeFromString(EntryInput.serializer(), queued.last().payloadJson).id,
                )
            } finally {
                source.close()
                target.close()
            }
        }

    @Test fun importingTheSameFileTwiceOrIntoTheSourceShopChangesNothing() =
        runTest {
            val device = Device()
            try {
                device.seed()
                val bytes = (device.service.export(SHOP, passphrase.toCharArray()) as BackupExportResult.Ok).bytes
                val before =
                    Triple(
                        device.customers(),
                        device.entries(),
                        device.fixture.db
                            .outboxDao()
                            .countPending(SHOP),
                    )
                val preview = (device.service.open(bytes, passphrase.toCharArray()) as BackupOpenResult.Ok).preview
                assertEquals(0, preview.newCustomers)
                assertEquals(0, preview.newEntries)
                assertEquals(BackupMergeResult.Ok(0, 0), device.service.merge(preview))
                assertEquals(BackupMergeResult.Ok(0, 0), device.service.merge(preview))
                assertEquals(
                    before,
                    Triple(
                        device.customers(),
                        device.entries(),
                        device.fixture.db
                            .outboxDao()
                            .countPending(SHOP),
                    ),
                )
            } finally {
                device.close()
            }
        }

    @Test fun secondImportOnAFreshDeviceAddsNothingAndQueuesNothingMore() =
        runTest {
            val source = Device()
            val target = Device()
            try {
                source.seed()
                val bytes = (source.service.export(SHOP, passphrase.toCharArray()) as BackupExportResult.Ok).bytes
                target.shop()
                val first = (target.service.open(bytes, passphrase.toCharArray()) as BackupOpenResult.Ok).preview
                target.service.merge(first)
                val outbox =
                    target.fixture.db
                        .outboxDao()
                        .countPending(SHOP)
                val second = (target.service.open(bytes, passphrase.toCharArray()) as BackupOpenResult.Ok).preview
                assertEquals(BackupMergeResult.Ok(0, 0), target.service.merge(second))
                assertEquals(
                    outbox,
                    target.fixture.db
                        .outboxDao()
                        .countPending(SHOP),
                )
                assertEquals(source.entries(), target.entries())
            } finally {
                source.close()
                target.close()
            }
        }

    @Test fun onlyTheOwnerCanExportOpenOrMerge() =
        runTest {
            val owner = Device()
            val staff = Device()
            try {
                owner.seed()
                val bytes = (owner.service.export(SHOP, passphrase.toCharArray()) as BackupExportResult.Ok).bytes
                val preview = (owner.service.open(bytes, passphrase.toCharArray()) as BackupOpenResult.Ok).preview
                staff.shop(role = "STAFF")
                assertEquals(
                    BackupExportResult.Failed(BackupProblem.NOT_OWNER),
                    staff.service.export(SHOP, passphrase.toCharArray()),
                )
                assertEquals(
                    BackupOpenResult.Failed(BackupProblem.NOT_OWNER),
                    staff.service.open(bytes, passphrase.toCharArray()),
                )
                assertEquals(BackupMergeResult.Failed(BackupProblem.NOT_OWNER), staff.service.merge(preview))
                assertEquals(emptyList<CustomerEntity>(), staff.customers())
                val stranger = Device()
                try {
                    assertEquals(
                        BackupOpenResult.Failed(BackupProblem.NOT_OWNER),
                        stranger.service.open(bytes, passphrase.toCharArray()),
                    )
                } finally {
                    stranger.close()
                }
            } finally {
                owner.close()
                staff.close()
            }
        }

    @Test fun wrongPassphraseAndForeignBytesAreReportedWithoutWriting() =
        runTest {
            val device = Device()
            try {
                device.seed()
                val bytes = (device.service.export(SHOP, passphrase.toCharArray()) as BackupExportResult.Ok).bytes
                assertEquals(
                    BackupOpenResult.Failed(BackupProblem.AUTHENTICATION),
                    device.service.open(bytes, "çetele yedeği 2026".toCharArray()),
                )
                assertEquals(
                    BackupOpenResult.Failed(BackupProblem.NOT_A_BACKUP),
                    device.service.open("id,name\n".toByteArray(), passphrase.toCharArray()),
                )
                assertEquals(
                    BackupOpenResult.Failed(BackupProblem.MALFORMED),
                    device.service.open(bytes.copyOf(bytes.size - 3), passphrase.toCharArray()),
                )
            } finally {
                device.close()
            }
        }

    @Test fun authenticatedButInvalidContentIsMalformed() =
        runTest {
            val device = Device()
            try {
                device.shop()
                val broken =
                    snapshot().copy(
                        entries = listOf(backupEntry(ORIGINAL, reversedBy = CORRECTION)),
                    )
                assertEquals(BackupProblem.MALFORMED, device.openCrafted(broken))
                val longName = snapshot().copy(customers = listOf(backupCustomer(CUSTOMER, "n".repeat(81))))
                assertEquals(BackupProblem.MALFORMED, device.openCrafted(longName))
                val currency = snapshot().copy(entries = listOf(backupEntry(ORIGINAL).copy(currency = "USD")))
                assertEquals(BackupProblem.MALFORMED, device.openCrafted(currency))
                val plain = "not json".toByteArray()
                val file = BackupCodec(FAST).encrypt(plain, passphrase.toCharArray())
                assertEquals(
                    BackupOpenResult.Failed(BackupProblem.MALFORMED),
                    device.service.open(file, passphrase.toCharArray()),
                )
            } finally {
                device.close()
            }
        }

    @Test fun idsHeldByAnotherShopAreAConflictAndNothingIsWritten() =
        runTest {
            val device = Device()
            try {
                device.shop()
                device.fixture.db
                    .customerDao()
                    .upsert(device.fixture.customer(CUSTOMER, shop = "other-shop"))
                val crafted = snapshot()
                val file =
                    BackupCodec(FAST).encrypt(
                        BackupJson.encodeToString(BackupSnapshot.serializer(), crafted).toByteArray(),
                        passphrase.toCharArray(),
                    )
                val preview = (device.service.open(file, passphrase.toCharArray()) as BackupOpenResult.Ok).preview
                assertEquals(BackupMergeResult.Failed(BackupProblem.CONFLICT), device.service.merge(preview))
                assertEquals(
                    "other-shop",
                    device.fixture.db
                        .customerDao()
                        .get("other-shop", CUSTOMER)!!
                        .shopId,
                )
                assertEquals(emptyList<LedgerEntryEntity>(), device.entries())
            } finally {
                device.close()
            }
        }

    @Test fun importedCorrectionLinksAnOriginalAlreadyOnTheDevice() =
        runTest {
            val device = Device()
            try {
                device.shop()
                device.fixture.db
                    .customerDao()
                    .upsert(device.fixture.customer(CUSTOMER, shop = SHOP))
                device.fixture.db
                    .ledgerEntryDao()
                    .insert(device.fixture.entry(ORIGINAL, SHOP, CUSTOMER))
                val crafted =
                    snapshot().copy(
                        entries =
                            listOf(
                                backupEntry(ORIGINAL, reversedBy = CORRECTION),
                                backupEntry(CORRECTION, reverses = ORIGINAL),
                            ),
                    )
                val file =
                    BackupCodec(FAST).encrypt(
                        BackupJson.encodeToString(BackupSnapshot.serializer(), crafted).toByteArray(),
                        passphrase.toCharArray(),
                    )
                val preview = (device.service.open(file, passphrase.toCharArray()) as BackupOpenResult.Ok).preview
                assertEquals(BackupMergeResult.Ok(0, 1), device.service.merge(preview))
                assertEquals(
                    CORRECTION,
                    device.fixture.db
                        .ledgerEntryDao()
                        .get(SHOP, ORIGINAL)!!
                        .reversedBy,
                )
                assertEquals(
                    ORIGINAL,
                    device.fixture.db
                        .ledgerEntryDao()
                        .get(SHOP, CORRECTION)!!
                        .reverses,
                )
                assertNull(
                    device.fixture.db
                        .ledgerEntryDao()
                        .get(SHOP, CORRECTION)!!
                        .reversedBy,
                )
            } finally {
                device.close()
            }
        }

    @Test fun correctionForALocalOriginalAlreadyCorrectedElsewhereIsAConflict() =
        runTest {
            val device = Device()
            try {
                device.shop()
                device.fixture.db
                    .customerDao()
                    .upsert(device.fixture.customer(CUSTOMER, shop = SHOP))
                device.fixture.db
                    .ledgerEntryDao()
                    .insert(device.fixture.entry(ORIGINAL, SHOP, CUSTOMER, reversedBy = PAYMENT))
                val crafted =
                    snapshot().copy(
                        entries =
                            listOf(
                                backupEntry(ORIGINAL, reversedBy = CORRECTION),
                                backupEntry(CORRECTION, reverses = ORIGINAL),
                            ),
                    )
                val preview =
                    BackupPreview(crafted, newCustomers = 0, newEntries = 1)
                assertEquals(BackupMergeResult.Failed(BackupProblem.CONFLICT), device.service.merge(preview))
                assertNull(
                    device.fixture.db
                        .ledgerEntryDao()
                        .get(SHOP, CORRECTION),
                )
                assertEquals(
                    PAYMENT,
                    device.fixture.db
                        .ledgerEntryDao()
                        .get(SHOP, ORIGINAL)!!
                        .reversedBy,
                )
            } finally {
                device.close()
            }
        }

    @Test fun mergeAnnouncesTheWriteOnlyWhenRowsWereAdded() =
        runTest {
            val events = mockk<LocalWriteEvents>(relaxed = true)
            val device = Device(events)
            val fresh = Device(events)
            try {
                device.seed()
                val bytes = (device.service.export(SHOP, passphrase.toCharArray()) as BackupExportResult.Ok).bytes
                val same = (device.service.open(bytes, passphrase.toCharArray()) as BackupOpenResult.Ok).preview
                device.service.merge(same)
                coVerify(exactly = 0) { events.written(any()) }
                fresh.shop()
                val preview = (fresh.service.open(bytes, passphrase.toCharArray()) as BackupOpenResult.Ok).preview
                assertTrue(fresh.service.merge(preview) is BackupMergeResult.Ok)
                coVerify(exactly = 1) { events.written(SHOP) }
            } finally {
                device.close()
                fresh.close()
            }
        }

    private class Device(
        events: LocalWriteEvents = LocalWriteEvents(),
    ) {
        val fixture = DataFixture()
        val service = BackupService(fixture.databases, fixture.clock, events, BackupCodec(FAST))

        suspend fun shop(role: String = "OWNER") {
            fixture.db.shopDao().upsertAll(
                listOf(
                    ShopEntity(SHOP, "Çınar Bakkalı", "BAKKAL", "İstanbul", "Kadıköy", "FREE", role, NOW, NOW),
                ),
            )
        }

        suspend fun seed() {
            shop()
            val dao = fixture.db.customerDao()
            dao.upsert(fixture.customer(CUSTOMER, SHOP, "Ayşe Yılmaz").copy(phone = "+905321234567", tag = "komşu"))
            dao.upsert(fixture.customer(GONE, SHOP, "Mehmet").copy(deletedAt = NOW, syncState = "PENDING"))
            val entries = fixture.db.ledgerEntryDao()
            entries.insert(
                fixture
                    .entry(
                        ORIGINAL,
                        SHOP,
                        CUSTOMER,
                        reversedBy = CORRECTION,
                    ).copy(photoKey = "photos/shop/entry.jpg"),
            )
            entries.insert(fixture.entry(CORRECTION, SHOP, CUSTOMER, reverses = ORIGINAL))
            entries.insert(fixture.entry(PAYMENT, SHOP, GONE, type = "PAYMENT", amount = 500, due = "2026-11-01"))
            entries.insert(
                fixture.entry(PENDING_ENTRY, SHOP, CUSTOMER, amount = 2500).copy(syncState = "PENDING", note = "çay"),
            )
        }

        suspend fun customers(): List<CustomerEntity> =
            fixture.db
                .customerDao()
                .observeAll(SHOP)
                .first()
                .sortedBy { it.id }

        suspend fun entries(): List<LedgerEntryEntity> =
            fixture.db
                .ledgerEntryDao()
                .all(SHOP)
                .sortedBy { it.id }

        suspend fun openCrafted(snapshot: BackupSnapshot): BackupProblem? {
            val file =
                BackupCodec(FAST).encrypt(
                    BackupJson.encodeToString(BackupSnapshot.serializer(), snapshot).toByteArray(),
                    "Çetele yedeği 2026".toCharArray(),
                )
            return (service.open(file, "Çetele yedeği 2026".toCharArray()) as? BackupOpenResult.Failed)?.problem
        }

        fun close() = fixture.close()
    }

    private companion object {
        val FAST = BackupKdf(BackupFormat.MIN_MEMORY_KIB, 1, 1)
        const val NOW = DataFixture.NOW
        const val SHOP = "0199b6a0-0000-7000-8000-000000000001"
        const val CUSTOMER = "0199b6a0-0000-7000-8000-000000000011"
        const val GONE = "0199b6a0-0000-7000-8000-000000000012"
        const val ORIGINAL = "0199b6a0-0000-7000-8000-000000000021"
        const val CORRECTION = "0199b6a0-0000-7000-8000-000000000022"
        const val PAYMENT = "0199b6a0-0000-7000-8000-000000000023"
        const val PENDING_ENTRY = "0199b6a0-0000-7000-8000-000000000024"

        fun snapshot(): BackupSnapshot =
            BackupSnapshot(
                shopId = SHOP,
                shopName = "Çınar Bakkalı",
                exportedAt = NOW,
                customers = listOf(backupCustomer(CUSTOMER, "Ayşe")),
                entries = listOf(backupEntry(ORIGINAL)),
            )

        fun backupCustomer(
            id: String,
            name: String,
        ): BackupCustomer =
            BackupCustomer(id, name, smsConsent = false, createdAt = NOW, updatedAt = NOW, synced = true)

        fun backupEntry(
            id: String,
            reverses: String? = null,
            reversedBy: String? = null,
        ): BackupEntry =
            BackupEntry(
                id,
                CUSTOMER,
                "DEBT",
                1000,
                "TRY",
                "2026-10-06",
                reverses = reverses,
                reversedBy = reversedBy,
                createdAt = NOW,
                synced = true,
            )
    }
}
