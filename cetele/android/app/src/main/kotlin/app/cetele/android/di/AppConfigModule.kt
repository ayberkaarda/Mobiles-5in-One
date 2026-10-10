package app.cetele.android.di

import app.cetele.android.BuildConfig
import app.cetele.android.core.network.ApiConfig
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppConfigModule {
    /** The version name travels as `appVersion` on OTP verification, so the server sees the installed build. */
    @Provides
    @Singleton
    fun provideApiConfig(): ApiConfig = ApiConfig(BuildConfig.API_BASE_URL, BuildConfig.VERSION_NAME)
}
