package app.cetele.android.di

import android.content.Context
import app.cetele.android.BuildConfig
import app.cetele.android.core.network.integrity.IntegrityTokenProvider
import app.cetele.android.core.network.pinning.CertificatePins
import app.cetele.android.integrity.PlayIntegrityTokenProvider
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object VariantNetworkModule {
    @Provides
    @Singleton
    fun integrity(
        @ApplicationContext context: Context,
    ): IntegrityTokenProvider = PlayIntegrityTokenProvider(context)

    @Provides
    @Singleton
    fun pins(): CertificatePins = CertificatePins.parse(BuildConfig.PINNING_ENABLED, BuildConfig.CERT_PINS)
}
