package app.cetele.android.di

import app.cetele.android.BuildConfig
import app.cetele.android.core.network.integrity.FakeIntegrityTokenProvider
import app.cetele.android.core.network.integrity.IntegrityTokenProvider
import app.cetele.android.core.network.pinning.CertificatePins
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object VariantNetworkModule {
    @Provides
    @Singleton
    fun integrity(): IntegrityTokenProvider = FakeIntegrityTokenProvider(BuildConfig.FAKE_INTEGRITY_TOKEN)

    @Provides
    @Singleton
    fun pins(): CertificatePins = CertificatePins.parse(BuildConfig.PINNING_ENABLED, BuildConfig.CERT_PINS)
}
