package app.cetele.android

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.Configuration
import app.cetele.android.core.data.lock.LockController
import app.cetele.android.di.ApplicationScope
import app.cetele.android.startup.AppVisibility
import app.cetele.android.startup.LockLifecycleObserver
import app.cetele.android.startup.SyncStartup
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import javax.inject.Inject

@HiltAndroidApp
class CeteleApplication :
    Application(),
    Configuration.Provider {
    @Inject
    lateinit var workerFactory: HiltWorkerFactory

    @Inject
    lateinit var syncStartup: SyncStartup

    @Inject
    lateinit var lock: LockController

    @Inject
    @ApplicationScope
    lateinit var appScope: CoroutineScope

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()

    override fun onCreate() {
        super.onCreate()
        syncStartup.start(appScope)
        val visibility =
            object : AppVisibility {
                override suspend fun onForeground() = lock.onAppStart()

                override suspend fun onBackground() = lock.onAppStop()
            }
        ProcessLifecycleOwner.get().lifecycle.addObserver(LockLifecycleObserver(visibility, appScope))
    }
}
