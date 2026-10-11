package app.cetele.android.core.data.lock

import android.content.Context
import android.os.SystemClock
import android.provider.Settings
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

interface ElapsedClock {
    fun millis(): Long

    fun bootCount(): Long
}

@Module
@InstallIn(SingletonComponent::class)
object ElapsedClockModule {
    @Provides
    @Singleton
    fun clock(
        @ApplicationContext context: Context,
    ): ElapsedClock =
        object : ElapsedClock {
            override fun millis(): Long = SystemClock.elapsedRealtime()

            override fun bootCount(): Long =
                Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, UNKNOWN_BOOT_COUNT).toLong()
        }

    private const val UNKNOWN_BOOT_COUNT = -1
}
