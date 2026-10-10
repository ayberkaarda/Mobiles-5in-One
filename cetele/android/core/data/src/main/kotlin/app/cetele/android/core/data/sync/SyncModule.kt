package app.cetele.android.core.data.sync

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

@Module
@InstallIn(SingletonComponent::class)
abstract class SyncModule {
    @Binds abstract fun localStore(store: RoomSyncLocalStore): SyncLocalStore
}
