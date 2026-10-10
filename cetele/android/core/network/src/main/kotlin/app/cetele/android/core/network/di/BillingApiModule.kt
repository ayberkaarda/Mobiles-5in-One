package app.cetele.android.core.network.di

import app.cetele.android.core.network.api.BillingApi
import app.cetele.android.core.network.api.KtorBillingApi
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

@Module
@InstallIn(SingletonComponent::class)
abstract class BillingApiModule {
    @Binds
    abstract fun billing(api: KtorBillingApi): BillingApi
}
