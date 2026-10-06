package app.cetele.android.core.data.database

import android.content.Context
import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import kotlinx.coroutines.Dispatchers

object TestDatabase {
    fun inMemory(context: Context): CeteleDatabase =
        Room
            .inMemoryDatabaseBuilder(context, CeteleDatabase::class.java)
            .setDriver(BundledSQLiteDriver())
            .setQueryCoroutineContext(Dispatchers.IO)
            .build()
}
