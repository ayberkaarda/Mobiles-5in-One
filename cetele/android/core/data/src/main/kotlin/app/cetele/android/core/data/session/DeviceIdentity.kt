package app.cetele.android.core.data.session

import app.cetele.android.core.data.settings.SettingsRepository
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class DeviceIdentity
    @Inject
    constructor(
        private val settings: SettingsRepository,
    ) {
        suspend fun id(): String =
            settings
                .update { current ->
                    if (current.deviceId == null) current.copy(deviceId = UUID.randomUUID().toString()) else current
                }.deviceId ?: error("Device identity is missing")
    }
