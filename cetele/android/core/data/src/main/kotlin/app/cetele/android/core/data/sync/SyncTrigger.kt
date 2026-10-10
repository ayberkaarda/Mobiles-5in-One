package app.cetele.android.core.data.sync

import app.cetele.android.core.data.write.LocalWriteEvents
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/** Turns every committed local write into an immediate sync request plus the periodic safety net. */
@Singleton
class SyncTrigger
    @Inject
    constructor(
        private val events: LocalWriteEvents,
        private val scheduler: SyncScheduler,
    ) {
        fun start(scope: CoroutineScope): Job =
            scope.launch {
                events.events.collect { shopId ->
                    scheduler.requestNow(shopId)
                    scheduler.ensurePeriodic(shopId)
                }
            }
    }
