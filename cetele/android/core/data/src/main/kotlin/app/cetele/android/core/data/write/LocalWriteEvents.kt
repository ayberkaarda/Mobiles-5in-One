package app.cetele.android.core.data.write

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class LocalWriteEvents
    @Inject
    constructor() {
        private companion object {
            const val BUFFER_CAPACITY = 64
        }

        private val mutableEvents = MutableSharedFlow<String>(extraBufferCapacity = BUFFER_CAPACITY)
        val events = mutableEvents.asSharedFlow()

        suspend fun written(shopId: String) {
            mutableEvents.emit(shopId)
        }
    }
