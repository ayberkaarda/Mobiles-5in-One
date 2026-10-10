package app.cetele.android.core.data.sync

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import java.time.Clock
import javax.inject.Inject
import javax.inject.Singleton

/** A persisted deadline prevents an early retry after process death or a new immediate request. */
@Singleton
class RetryAfterPolicy
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
        private val clock: Clock,
    ) {
        private val preferences = context.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)

        /** Forgets every deadline and deletes the preferences file (session wipe). */
        @Synchronized fun clear() {
            // The cached instance must be emptied too; deleting only the file would keep its in-memory values.
            check(preferences.edit().clear().commit())
            context.deleteSharedPreferences(FILE_NAME)
        }

        @Synchronized fun defer(
            shopId: String,
            seconds: Int,
        ) {
            val deadline = Math.addExact(clock.millis(), TimeUnitMillis.seconds(seconds.coerceAtLeast(1)))
            val previous = preferences.getLong(shopId, 0)
            check(preferences.edit().putLong(shopId, maxOf(previous, deadline)).commit())
        }

        @Synchronized fun remainingSeconds(shopId: String): Int {
            val remaining = (preferences.getLong(shopId, 0) - clock.millis()).coerceAtLeast(0)
            return ((remaining + MILLIS_PER_SECOND - 1) / MILLIS_PER_SECOND)
                .coerceAtMost(
                    Int.MAX_VALUE.toLong(),
                ).toInt()
        }

        companion object {
            const val FILE_NAME = "sync_retry"
            const val WAIT_CHUNK_SECONDS = 60
            private const val MILLIS_PER_SECOND = 1000L
        }
    }
