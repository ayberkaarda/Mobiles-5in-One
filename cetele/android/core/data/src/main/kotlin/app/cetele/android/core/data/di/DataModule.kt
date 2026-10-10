package app.cetele.android.core.data.di

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.core.DataStoreFactory
import androidx.datastore.dataStoreFile
import app.cetele.android.core.data.settings.UserSettings
import app.cetele.android.core.data.settings.UserSettingsSerializer
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import java.time.Clock
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DataModule {
    @Provides
    fun provideClock(): Clock = Clock.systemUTC()

    private const val USER_SETTINGS_FILE = "user_settings.pb"

    @Provides
    @Singleton
    fun provideUserSettingsStore(
        @ApplicationContext context: Context,
    ): DataStore<UserSettings> =
        DataStoreFactory.create(
            serializer = UserSettingsSerializer,
            produceFile = { context.dataStoreFile(USER_SETTINGS_FILE) },
        )
}
