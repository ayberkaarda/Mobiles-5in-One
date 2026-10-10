package app.cetele.android.core.data.settings

import androidx.datastore.core.DataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SettingsRepository
    @Inject
    constructor(
        private val store: DataStore<UserSettings>,
    ) {
        val settings: Flow<UserSettings> = store.data

        suspend fun current(): UserSettings = settings.first()

        suspend fun update(transform: (UserSettings) -> UserSettings): UserSettings = store.updateData(transform)

        suspend fun clearSession() {
            update { UserSettings(deviceId = it.deviceId, themeMode = it.themeMode) }
        }
    }
