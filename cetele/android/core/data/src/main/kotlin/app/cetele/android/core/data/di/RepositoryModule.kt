package app.cetele.android.core.data.di

import app.cetele.android.core.data.media.PhotoRepository
import app.cetele.android.core.data.media.StoredPhotoRepository
import app.cetele.android.core.data.repository.CustomerRepository
import app.cetele.android.core.data.repository.DashboardRepository
import app.cetele.android.core.data.repository.LedgerRepository
import app.cetele.android.core.data.repository.ReminderLogRepository
import app.cetele.android.core.data.repository.RoomCustomerRepository
import app.cetele.android.core.data.repository.RoomDashboardRepository
import app.cetele.android.core.data.repository.RoomLedgerRepository
import app.cetele.android.core.data.repository.RoomReminderLogRepository
import app.cetele.android.core.data.repository.RoomShopRepository
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.data.session.SessionManager
import app.cetele.android.core.data.session.SessionWork
import app.cetele.android.core.data.session.WorkSession
import app.cetele.android.core.data.vault.KeystoreVault
import app.cetele.android.core.data.vault.Vault
import app.cetele.android.core.network.auth.TokenRefresher
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {
    @Binds @Singleton
    abstract fun vault(implementation: KeystoreVault): Vault

    @Binds @Singleton
    abstract fun shops(implementation: RoomShopRepository): ShopRepository

    @Binds @Singleton
    abstract fun customers(implementation: RoomCustomerRepository): CustomerRepository

    @Binds @Singleton
    abstract fun ledger(implementation: RoomLedgerRepository): LedgerRepository

    @Binds @Singleton
    abstract fun dashboard(implementation: RoomDashboardRepository): DashboardRepository

    @Binds @Singleton
    abstract fun reminders(implementation: RoomReminderLogRepository): ReminderLogRepository

    @Binds @Singleton
    abstract fun photos(implementation: StoredPhotoRepository): PhotoRepository

    @Binds abstract fun refresher(implementation: SessionManager): TokenRefresher

    @Binds abstract fun work(implementation: WorkSession): SessionWork
}
