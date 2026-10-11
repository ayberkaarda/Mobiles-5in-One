package app.cetele.android.feature.export.di

import android.content.Context
import app.cetele.android.core.data.session.LocalDataWiper
import app.cetele.android.feature.export.share.ExportFiles
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet

@Module
@InstallIn(SingletonComponent::class)
object ExportWiperModule {
    @Provides
    @IntoSet
    fun exports(
        @ApplicationContext context: Context,
    ): LocalDataWiper = LocalDataWiper { ExportFiles(context.cacheDir).wipe() }
}
