package app.cetele.android.core.data.database

import android.app.Application
import android.content.Context
import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.execSQL
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class)
class MigrationTest {
    @Test fun committedV1CursorSurvivesAndRoomValidatesV2() =
        runTest {
            val context = ApplicationProvider.getApplicationContext<Context>()
            val path = File(context.noBackupFilesDir, "migration-" + java.util.UUID.randomUUID() + ".db")
            val driver = BundledSQLiteDriver()
            val schemaPath =
                sequenceOf(
                    File("schemas"),
                    File("core/data/schemas"),
                    File("cetele/android/core/data/schemas"),
                ).first {
                    it.isDirectory
                }
            val schema =
                Json
                    .parseToJsonElement(
                        File(schemaPath, "app.cetele.android.core.data.database.CeteleDatabase/1.json").readText(),
                    ).jsonObject
                    .getValue("database")
                    .jsonObject
            driver.open(path.path).use { connection ->
                schema.getValue("entities").jsonArray.forEach { entity ->
                    val item = entity.jsonObject
                    connection.execSQL(
                        item
                            .getValue(
                                "createSql",
                            ).jsonPrimitive.content
                            .replace(
                                "\u0024{TABLE_NAME}",
                                item.getValue("tableName").jsonPrimitive.content,
                            ),
                    )
                }
                schema.getValue("setupQueries").jsonArray.forEach { connection.execSQL(it.jsonPrimitive.content) }
                connection.execSQL("INSERT INTO sync_cursor(shop_id, last_pulled_seq) VALUES ('shop-a', 37)")
                connection.execSQL("PRAGMA user_version = 1")
            }
            val db =
                Room
                    .databaseBuilder(context, CeteleDatabase::class.java, path.path)
                    .setDriver(driver)
                    .setQueryCoroutineContext(Dispatchers.IO)
                    .addMigrations(Migrations.MIGRATION_1_2)
                    .build()
            try {
                val cursor = db.syncCursorDao().get("shop-a")!!
                assertEquals(37L, cursor.lastPulledSeq)
                assertEquals(1L, cursor.nextClientSeq)
                assertNull(cursor.lastPushAt)
                assertNull(cursor.lastPullAt)
                assertNull(cursor.lastErrorCode)
                assertEquals(1L..3L, db.syncCursorDao().allocateClientSeqs("shop-a", 3))
                assertEquals(4L, db.syncCursorDao().get("shop-a")?.nextClientSeq)
                assertEquals(0, db.customerDao().countLive("shop-a"))
                assertTrue(db.outboxDao().queued("shop-a", 10).isEmpty())
            } finally {
                db.close()
                listOf(path, File(path.path + "-wal"), File(path.path + "-shm")).forEach { it.delete() }
            }
        }
}
