package app.cetele.android.core.data.database

import androidx.room.Database
import androidx.room.RoomDatabase

/** Local encrypted store. Ledger tables arrive with the offline-first sync engine. */
@Database(entities = [SyncCursorEntity::class], version = 1, exportSchema = true)
abstract class CeteleDatabase : RoomDatabase()
