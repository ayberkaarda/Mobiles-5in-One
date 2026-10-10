package app.cetele.android.core.network.di

import app.cetele.android.core.network.ApiConfig
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.HttpClientFactory
import app.cetele.android.core.network.auth.AccessTokenHolder
import app.cetele.android.core.network.auth.TokenRefresher
import app.cetele.android.core.network.pinning.CertificatePins
import dagger.BindsOptionalOf
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.ktor.client.HttpClient
import io.ktor.http.HttpStatusCode
import java.util.Optional
import javax.inject.Provider
import javax.inject.Qualifier
import javax.inject.Singleton

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class ApiClient

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class StorageClient

@Module
@InstallIn(SingletonComponent::class)
abstract class OptionalSessionModule {
    @BindsOptionalOf
    abstract fun tokenRefresher(): TokenRefresher
}

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {
    @Provides
    @Singleton
    @ApiClient
    fun provideApiClient(
        config: ApiConfig,
        pins: CertificatePins,
        tokens: AccessTokenHolder,
        refresher: Provider<Optional<TokenRefresher>>,
    ): HttpClient =
        HttpClientFactory.createApiClient(
            config,
            pins,
            tokens,
            object : TokenRefresher {
                override suspend fun refresh() =
                    refresher.get().orElse(null)?.refresh()
                        ?: ApiResult.Failure.Unexpected(HttpStatusCode.Unauthorized.value)

                override suspend fun onRefreshInvalid() {
                    refresher.get().orElse(null)?.onRefreshInvalid()
                }
            },
        )

    @Provides
    @Singleton
    @StorageClient
    fun provideStorageClient(): HttpClient = HttpClientFactory.createStorageClient()
}
