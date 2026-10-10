package app.cetele.android.core.data.database

import android.content.Context
import app.cetele.android.core.data.vault.Vault
import app.cetele.android.core.data.vault.VaultKeys
import dagger.hilt.android.qualifiers.ApplicationContext
import java.security.SecureRandom
import javax.inject.Inject
import javax.inject.Singleton

/** Repositories acquire the current database for each operation, allowing sign-in after a wipe. */
@Singleton
class DatabaseStore(
    private val open: () -> CeteleDatabase,
    private val deleteFiles: () -> Unit,
) {
    @Inject
    constructor(
        @ApplicationContext context: Context,
        vault: Vault,
    ) : this(
        open = {
            val passphrase =
                vault.get(VaultKeys.DB_PASSPHRASE) ?: ByteArray(PASSPHRASE_BYTES).also {
                    SecureRandom().nextBytes(it)
                    vault.put(VaultKeys.DB_PASSPHRASE, it)
                }
            CeteleDatabaseFactory.create(context, passphrase)
        },
        deleteFiles = {
            check(
                context.deleteDatabase(CeteleDatabaseFactory.FILE_NAME) ||
                    !context.getDatabasePath(CeteleDatabaseFactory.FILE_NAME).exists(),
            )
        },
    )

    private companion object {
        const val PASSPHRASE_BYTES = 32
    }

    private var current: CeteleDatabase? = null

    @Synchronized fun get(): CeteleDatabase = current ?: open().also { current = it }

    @Synchronized fun wipe() {
        current?.close()
        current = null
        deleteFiles()
    }
}
