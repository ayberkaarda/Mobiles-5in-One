package app.cetele.android.core.data.session

import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.Multibinds

fun interface LocalDataWiper {
    fun wipe()
}

@Module
@InstallIn(SingletonComponent::class)
abstract class LocalDataWiperModule {
    @Multibinds
    abstract fun wipers(): Set<LocalDataWiper>
}
