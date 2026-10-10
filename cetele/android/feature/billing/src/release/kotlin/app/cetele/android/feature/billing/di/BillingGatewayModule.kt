package app.cetele.android.feature.billing.di

import app.cetele.android.feature.billing.gateway.BillingGateway
import app.cetele.android.feature.billing.gateway.PlayBillingGateway
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/** Release builds always use Google Play; the fake gateway is not compiled into them. */
@Module
@InstallIn(SingletonComponent::class)
abstract class BillingGatewayModule {
    @Binds
    abstract fun gateway(play: PlayBillingGateway): BillingGateway
}
