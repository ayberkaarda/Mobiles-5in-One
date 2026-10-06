package app.cetele.android.core.data.repository

import android.app.Application
import androidx.datastore.core.DataStoreFactory
import app.cetele.android.core.data.database.DataFixture
import app.cetele.android.core.data.database.SyncCursorEntity
import app.cetele.android.core.data.database.entity.OutboxEntity
import app.cetele.android.core.data.database.entity.PendingPhotoEntity
import app.cetele.android.core.data.database.entity.ReminderLogEntity
import app.cetele.android.core.data.database.entity.ShopEntity
import app.cetele.android.core.data.session.SessionManager
import app.cetele.android.core.data.settings.SettingsRepository
import app.cetele.android.core.data.settings.UserSettings
import app.cetele.android.core.data.settings.UserSettingsSerializer
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.MeApi
import app.cetele.android.core.network.api.ShopsApi
import app.cetele.android.core.network.dto.ShopPlan
import app.cetele.android.core.network.dto.ShopRole
import app.cetele.android.core.network.dto.ShopType
import app.cetele.android.core.network.dto.me.Me
import app.cetele.android.core.network.dto.me.MembershipSummary
import app.cetele.android.core.network.dto.shops.ShopView
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class)
class ShopRepositoryTest {
    @Test fun lostMembershipPurgesOnlyItsRowsAndPhotos() =
        runTest {
            val f = DataFixture()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
            val settingsFile = File(f.context.noBackupFilesDir, "shop-settings-" + java.util.UUID.randomUUID())
            try {
                val settings =
                    SettingsRepository(DataStoreFactory.create(UserSettingsSerializer, scope = scope) { settingsFile })
                settings.update { UserSettings(activeShopId = "shop-a") }
                val now = DataFixture.NOW
                f.db.shopDao().upsertAll(
                    listOf("shop-a", "shop-b").map {
                        ShopEntity(it, it, "BAKKAL", "İstanbul", "Kadıköy", "FREE", "STAFF", now, now)
                    },
                )
                f.db.customerDao().upsert(f.customer())
                f.db.customerDao().upsert(f.customer("customer-b", "shop-b"))
                f.db.ledgerEntryDao().insert(f.entry())
                f.db.ledgerEntryDao().insert(f.entry("entry-b", "shop-b", "customer-b"))
                f.db.outboxDao().insert(
                    OutboxEntity(
                        "operation-a",
                        "shop-a",
                        "ENTRY_CREATE",
                        "entry-a",
                        "{}",
                        now,
                        null,
                        null,
                        null,
                        "QUEUED",
                        0,
                        null,
                        null,
                        now,
                    ),
                )
                f.db.pendingPhotoDao().upsert(
                    PendingPhotoEntity(
                        "entry-a",
                        "shop-a",
                        f.photos.save("entry-a", byteArrayOf(1)),
                        1,
                        null,
                        null,
                        "QUEUED",
                        0,
                        null,
                        now,
                        now,
                    ),
                )
                f.db.syncCursorDao().upsert(SyncCursorEntity("shop-a", 10))
                f.db.reminderLogDao().insert(
                    ReminderLogEntity("reminder-a", "shop-a", "customer-a", "WHATSAPP", now, "SENT", null, null),
                )
                val me = mockk<MeApi>()
                val shops = mockk<ShopsApi>()
                val session = mockk<SessionManager>(relaxed = true)
                coEvery { me.me() } returns
                    ApiResult.Success(
                        Me("user", "phone", memberships = listOf(MembershipSummary("shop-b", ShopRole.STAFF))),
                        200,
                    )
                coEvery { shops.get("shop-b") } returns
                    ApiResult.Success(
                        ShopView(
                            "shop-b",
                            "Kept",
                            ShopType.BAKKAL,
                            "İstanbul",
                            "Kadıköy",
                            ShopPlan.FREE,
                            ShopRole.STAFF,
                            f.clock.instant(),
                        ),
                        200,
                    )
                val repository = RoomShopRepository(f.databases, me, shops, settings, session, f.photos, f.clock)
                assertTrue(repository.refresh() is ApiResult.Success)
                assertNull(f.db.customerDao().get("shop-a", "customer-a"))
                assertTrue(
                    f.db
                        .ledgerEntryDao()
                        .all("shop-a")
                        .isEmpty(),
                )
                assertEquals(0, f.db.outboxDao().countPending("shop-a"))
                assertNull(f.db.pendingPhotoDao().get("shop-a", "entry-a"))
                assertNull(f.db.syncCursorDao().get("shop-a"))
                assertNull(f.photos.open("entry-a"))
                assertEquals(1, f.db.customerDao().countLive("shop-b"))
                assertEquals(
                    1,
                    f.db
                        .ledgerEntryDao()
                        .all("shop-b")
                        .size,
                )
                coVerify(exactly = 1) { session.onMembershipLost("shop-a") }
            } finally {
                scope.cancel()
                f.close()
                settingsFile.delete()
            }
        }
}
