package app.cetele.android.core.network.di

import app.cetele.android.core.network.api.AuthApi
import app.cetele.android.core.network.api.KtorAuthApi
import app.cetele.android.core.network.api.KtorMeApi
import app.cetele.android.core.network.api.KtorMediaApi
import app.cetele.android.core.network.api.KtorRemindersApi
import app.cetele.android.core.network.api.KtorShopsApi
import app.cetele.android.core.network.api.KtorStatementsApi
import app.cetele.android.core.network.api.KtorSyncApi
import app.cetele.android.core.network.api.MeApi
import app.cetele.android.core.network.api.MediaApi
import app.cetele.android.core.network.api.RemindersApi
import app.cetele.android.core.network.api.ShopsApi
import app.cetele.android.core.network.api.StatementsApi
import app.cetele.android.core.network.api.SyncApi
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

@Module
@InstallIn(SingletonComponent::class)
abstract class ApiModule {
    @Binds
    abstract fun auth(api: KtorAuthApi): AuthApi

    @Binds
    abstract fun me(api: KtorMeApi): MeApi

    @Binds
    abstract fun shops(api: KtorShopsApi): ShopsApi

    @Binds
    abstract fun sync(api: KtorSyncApi): SyncApi

    @Binds
    abstract fun statements(api: KtorStatementsApi): StatementsApi

    @Binds
    abstract fun reminders(api: KtorRemindersApi): RemindersApi

    @Binds
    abstract fun media(api: KtorMediaApi): MediaApi
}
