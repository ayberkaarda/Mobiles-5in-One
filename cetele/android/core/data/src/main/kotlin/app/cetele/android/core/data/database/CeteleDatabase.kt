package app.cetele.android.core.data.database

import androidx.room.Database
import androidx.room.RoomDatabase
import app.cetele.android.core.data.database.dao.CustomerDao
import app.cetele.android.core.data.database.dao.DashboardDao
import app.cetele.android.core.data.database.dao.LedgerEntryDao
import app.cetele.android.core.data.database.dao.OutboxDao
import app.cetele.android.core.data.database.dao.PendingPhotoDao
import app.cetele.android.core.data.database.dao.ReminderLogDao
import app.cetele.android.core.data.database.dao.ShopDao
import app.cetele.android.core.data.database.dao.SyncCursorDao
import app.cetele.android.core.data.database.entity.CustomerEntity
import app.cetele.android.core.data.database.entity.LedgerEntryEntity
import app.cetele.android.core.data.database.entity.OutboxEntity
import app.cetele.android.core.data.database.entity.PendingPhotoEntity
import app.cetele.android.core.data.database.entity.ReminderLogEntity
import app.cetele.android.core.data.database.entity.ShopEntity

@Database(
    entities = [
        ShopEntity::class, CustomerEntity::class, LedgerEntryEntity::class,
        OutboxEntity::class, PendingPhotoEntity::class, SyncCursorEntity::class, ReminderLogEntity::class,
    ],
    version = 2,
    exportSchema = true,
)
abstract class CeteleDatabase : RoomDatabase() {
    abstract fun shopDao(): ShopDao

    abstract fun customerDao(): CustomerDao

    abstract fun ledgerEntryDao(): LedgerEntryDao

    abstract fun dashboardDao(): DashboardDao

    abstract fun outboxDao(): OutboxDao

    abstract fun pendingPhotoDao(): PendingPhotoDao

    abstract fun syncCursorDao(): SyncCursorDao

    abstract fun reminderLogDao(): ReminderLogDao
}
