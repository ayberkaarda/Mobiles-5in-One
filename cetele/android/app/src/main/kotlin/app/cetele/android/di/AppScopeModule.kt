package app.cetele.android.di

import app.cetele.android.startup.SchedulerSyncRequests
import app.cetele.android.startup.SyncRequests
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import javax.inject.Qualifier
import javax.inject.Singleton

/** Scope that lives as long as the process: sync triggering and lock bookkeeping run here. */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class ApplicationScope

@Module
@InstallIn(SingletonComponent::class)
abstract class AppScopeModule {
    @Binds
    abstract fun syncRequests(implementation: SchedulerSyncRequests): SyncRequests

    companion object {
        @Provides
        @Singleton
        @ApplicationScope
        fun applicationScope(): CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    }
}
