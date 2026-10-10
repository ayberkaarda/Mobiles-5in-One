package app.cetele.android.core.data.database

import androidx.room.immediateTransaction
import androidx.room.useWriterConnection

/**
 * Runs [block] in one immediate write transaction. Works with both the SQLCipher open helper used in
 * production and the bundled SQLite driver used in JVM tests; DAO calls inside the block share the
 * transaction's connection. Throwing rolls everything back.
 */
suspend fun <R> CeteleDatabase.writeTransaction(block: suspend () -> R): R =
    useWriterConnection { transactor -> transactor.immediateTransaction { block() } }
