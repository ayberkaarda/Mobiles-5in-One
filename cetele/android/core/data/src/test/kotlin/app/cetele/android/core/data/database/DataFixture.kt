package app.cetele.android.core.data.database

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import app.cetele.android.core.data.database.entity.CustomerEntity
import app.cetele.android.core.data.database.entity.LedgerEntryEntity
import app.cetele.android.core.data.media.EncryptedPhotoStore
import app.cetele.android.core.data.vault.InMemoryVault
import app.cetele.android.core.data.write.LocalWriteEvents
import app.cetele.android.core.data.write.LocalWriteService
import java.io.File
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

class DataFixture {
    val context: Context = ApplicationProvider.getApplicationContext()
    val db = TestDatabase.inMemory(context)
    val databases = DatabaseStore({ db }, {})
    val vault = InMemoryVault()
    val clock: Clock = Clock.fixed(Instant.parse(NOW), ZoneOffset.UTC)
    val directory = File(context.noBackupFilesDir, "test-photos-" + java.util.UUID.randomUUID())
    val photos = EncryptedPhotoStore(directory, vault)
    val writes = LocalWriteService(databases, clock, photos, vault, LocalWriteEvents())

    fun customer(
        id: String = "customer-a",
        shop: String = "shop-a",
        name: String = "İsmail",
        deleted: String? = null,
    ): CustomerEntity =
        CustomerEntity(
            id,
            shop,
            name,
            app.cetele.android.core.data.repository.SearchNormalizer
                .normalize(name),
            null,
            null,
            null,
            false,
            null,
            null,
            NOW,
            NOW,
            deleted,
            "SYNCED",
        )

    @Suppress("LongParameterList")
    fun entry(
        id: String = "entry-a",
        shop: String = "shop-a",
        customer: String = "customer-a",
        type: String = "DEBT",
        amount: Long = 1000,
        reverses: String? = null,
        reversedBy: String? = null,
        due: String? = null,
    ): LedgerEntryEntity =
        LedgerEntryEntity(
            id,
            shop,
            customer,
            type,
            amount,
            "TRY",
            "2026-10-06",
            due,
            null,
            null,
            reverses,
            reversedBy,
            null,
            NOW,
            "SYNCED",
        )

    fun close() {
        db.close()
        photos.clear()
        directory.delete()
    }

    companion object {
        const val NOW = "2026-10-06T10:00:00Z"
    }
}
