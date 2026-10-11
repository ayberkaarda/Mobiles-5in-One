package app.cetele.android.di

import app.cetele.android.feature.billing.link.PurchaseLinker
import app.cetele.android.startup.PurchaseRestore
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

@Module
@InstallIn(SingletonComponent::class)
object BillingStartupModule {
    /** The report is not needed at start-up: each link outcome is handled (or queued) by the linker itself. */
    @Provides
    fun purchaseRestore(linker: PurchaseLinker): PurchaseRestore =
        object : PurchaseRestore {
            override suspend fun restore() {
                linker.restore()
            }
        }
}
