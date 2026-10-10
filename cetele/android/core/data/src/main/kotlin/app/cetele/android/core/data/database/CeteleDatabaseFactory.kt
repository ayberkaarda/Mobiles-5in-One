package app.cetele.android.core.data.database

import android.content.Context
import androidx.room.Room
import net.zetetic.database.sqlcipher.SupportOpenHelperFactory

/**
 * Opens the Room database through SQLCipher. The passphrase is created once on the device and
 * kept wrapped by the Android Keystore; it is never logged, persisted in plain text or sent anywhere.
 */
object CeteleDatabaseFactory {
    const val FILE_NAME: String = "cetele.db"

    private const val SQLCIPHER_LIBRARY = "sqlcipher"

    fun create(
        context: Context,
        passphrase: ByteArray,
    ): CeteleDatabase {
        System.loadLibrary(SQLCIPHER_LIBRARY)
        return Room
            .databaseBuilder(context.applicationContext, CeteleDatabase::class.java, FILE_NAME)
            .openHelperFactory(SupportOpenHelperFactory(passphrase))
            .addMigrations(Migrations.MIGRATION_1_2)
            .build()
    }
}
