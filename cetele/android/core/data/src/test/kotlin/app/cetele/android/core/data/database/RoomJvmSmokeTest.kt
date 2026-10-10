package app.cetele.android.core.data.database

import android.app.Application
import androidx.room.Room
import androidx.room.useReaderConnection
import androidx.room.useWriterConnection
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class)
class RoomJvmSmokeTest {
    @Test
    fun bundledDriverWritesAndReadsTheRoomSchema() =
        runTest {
            val database =
                Room
                    .inMemoryDatabaseBuilder(
                        ApplicationProvider.getApplicationContext(),
                        CeteleDatabase::class.java,
                    ).setDriver(BundledSQLiteDriver())
                    .setQueryCoroutineContext(Dispatchers.IO)
                    .build()
            try {
                database.useWriterConnection { connection ->
                    connection.usePrepared(
                        "INSERT INTO sync_cursor(shop_id, last_pulled_seq) VALUES (?, ?)",
                    ) { statement ->
                        statement.bindText(1, "smoke-shop")
                        statement.bindLong(2, 42)
                        statement.step()
                    }
                }
                val value =
                    database.useReaderConnection { connection ->
                        connection.usePrepared(
                            "SELECT last_pulled_seq FROM sync_cursor WHERE shop_id = ?",
                        ) { statement ->
                            statement.bindText(1, "smoke-shop")
                            check(statement.step())
                            statement.getLong(0)
                        }
                    }
                assertEquals(42L, value)
            } finally {
                database.close()
            }
        }
}
