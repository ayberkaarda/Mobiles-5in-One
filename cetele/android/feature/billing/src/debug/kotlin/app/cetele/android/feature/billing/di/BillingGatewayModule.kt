package app.cetele.android.feature.billing.di

import app.cetele.android.feature.billing.BuildConfig
import app.cetele.android.feature.billing.gateway.BillingGateway
import app.cetele.android.feature.billing.gateway.FakeBillingGateway
import app.cetele.android.feature.billing.gateway.PlayBillingGateway
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Provider
import javax.inject.Singleton

/** Debug builds: `cetele.billingMode` in `local.properties` selects the fake (default) or the Play gateway. */
@Module
@InstallIn(SingletonComponent::class)
object BillingGatewayModule {
    @Provides
    @Singleton
    fun gateway(play: Provider<PlayBillingGateway>): BillingGateway =
        if (BuildConfig.BILLING_MODE == "play") play.get() else FakeBillingGateway(BuildConfig.FAKE_BILLING_STATE)
}
