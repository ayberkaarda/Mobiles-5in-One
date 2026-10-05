package app.cetele.android.core.network.di

import app.cetele.android.core.network.ApiConfig
import app.cetele.android.core.network.createHttpClient
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.ktor.client.HttpClient
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {
    @Provides
    @Singleton
    fun provideHttpClient(config: ApiConfig): HttpClient = createHttpClient(config)
}
