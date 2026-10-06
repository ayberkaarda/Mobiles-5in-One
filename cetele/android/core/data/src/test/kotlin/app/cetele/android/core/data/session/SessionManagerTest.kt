package app.cetele.android.core.data.session

import android.app.Application
import android.content.Context
import androidx.datastore.core.DataStoreFactory
import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.test.core.app.ApplicationProvider
import app.cetele.android.core.data.database.CeteleDatabase
import app.cetele.android.core.data.database.DatabaseStore
import app.cetele.android.core.data.database.SyncCursorEntity
import app.cetele.android.core.data.lock.LockController
import app.cetele.android.core.data.lock.PinHasher
import app.cetele.android.core.data.lock.PinStore
import app.cetele.android.core.data.media.EncryptedPhotoStore
import app.cetele.android.core.data.settings.SettingsRepository
import app.cetele.android.core.data.settings.ThemeMode
import app.cetele.android.core.data.settings.UserSettings
import app.cetele.android.core.data.settings.UserSettingsSerializer
import app.cetele.android.core.data.vault.InMemoryVault
import app.cetele.android.core.data.vault.VaultKeys
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.ProblemDetail
import app.cetele.android.core.network.api.AuthApi
import app.cetele.android.core.network.auth.AccessTokenHolder
import app.cetele.android.core.network.auth.RefreshCoordinator
import app.cetele.android.core.network.dto.auth.RefreshBody
import app.cetele.android.core.network.dto.auth.SignInResponse
import app.cetele.android.core.network.dto.auth.TokenResponse
import app.cetele.android.core.network.dto.auth.UserSummary
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.time.Clock
import javax.inject.Provider

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class)
class SessionManagerTest {
    private class Fixture {
        val context: Context = ApplicationProvider.getApplicationContext()
        val directory = File(context.noBackupFilesDir, "session-" + java.util.UUID.randomUUID()).apply { mkdirs() }
        val databaseFile = File(directory, "cetele.db")
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val settings =
            SettingsRepository(
                DataStoreFactory.create(UserSettingsSerializer, scope = scope) { File(directory, "settings.pb") },
            )
        val vault = InMemoryVault()
        val tokens = AccessTokenHolder()
        val auth = mockk<AuthApi>()
        val work = mockk<SessionWork>(relaxed = true)
        val databases =
            DatabaseStore({
                Room
                    .databaseBuilder(context, CeteleDatabase::class.java, databaseFile.path)
                    .setDriver(BundledSQLiteDriver())
                    .setQueryCoroutineContext(Dispatchers.IO)
                    .build()
            }, {
                listOf(databaseFile, File(databaseFile.path + "-wal"), File(databaseFile.path + "-shm")).forEach {
                    check(it.delete() || !it.exists())
                }
            })
        val photos = EncryptedPhotoStore(File(directory, "photos"), vault)
        val pins = PinStore(vault, PinHasher(), Clock.systemUTC())
        val lock = LockController(pins, settings, Clock.systemUTC())
        val manager = SessionManager(Provider { auth }, tokens, vault, databases, photos, settings, work, lock)
        val initialAccess = "access-" + java.util.UUID.randomUUID()
        val initialRefresh = "refresh-" + java.util.UUID.randomUUID()

        suspend fun signIn() {
            manager.signIn(SignInResponse(initialAccess, 900, initialRefresh, UserSummary("user-a"), true), "phone-a")
        }

        fun close() {
            scope.cancel()
            databases.wipe()
            photos.clear()
            directory.listFiles()?.forEach { it.delete() }
            directory.delete()
        }
    }

    @Test fun userSignOutWipesAllSecretsFilesAndSessionSettings() =
        runTest {
            val f = Fixture()
            try {
                f.signIn()
                f.settings.update { UserSettings(300, true, "shop-a", ThemeMode.DARK, "device-a", 123, true) }
                f.databases
                    .get()
                    .syncCursorDao()
                    .upsert(SyncCursorEntity("shop-a", 5))
                f.vault.put(VaultKeys.DB_PASSPHRASE, ByteArray(32) { 1 })
                f.pins.set(CharArray(6) { '1' })
                f.photos.save("entry-a", byteArrayOf(1, 2))
                assertTrue(f.databaseFile.exists())
                coEvery { f.auth.logout() } returns ApiResult.Failure.Network(java.io.IOException("offline"))
                f.manager.signOut(SignOutReason.USER)
                assertEquals(SessionState.SignedOut(SignOutReason.USER), f.manager.state.value)
                assertNull(f.tokens.accessToken)
                assertTrue(f.vault.keys().isEmpty())
                assertFalse(f.databaseFile.exists())
                assertNull(f.photos.open("entry-a"))
                assertEquals(UserSettings(themeMode = ThemeMode.DARK, deviceId = "device-a"), f.settings.current())
                coVerify(exactly = 1) { f.work.cancelAll() }
                coVerify(exactly = 1) { f.auth.logout() }
                f.signIn()
                f.databases
                    .get()
                    .syncCursorDao()
                    .upsert(SyncCursorEntity("fresh", 1))
                assertNull(
                    f.databases
                        .get()
                        .syncCursorDao()
                        .get("shop-a"),
                )
            } finally {
                f.close()
            }
        }

    @Test fun refreshRotationAndInvalidRefreshEndSession() =
        runTest {
            val f = Fixture()
            try {
                f.signIn()
                val rotated = "refresh-" + java.util.UUID.randomUUID()
                val access = "access-" + java.util.UUID.randomUUID()
                coEvery { f.auth.refresh(RefreshBody(f.initialRefresh)) } returns
                    ApiResult.Success(TokenResponse(access, 900, rotated), 200)
                coEvery { f.auth.logout() } returns ApiResult.Failure.Unexpected(401)
                val coordinator = RefreshCoordinator(f.tokens, f.manager)
                assertEquals(access, coordinator.refresh(f.initialAccess))
                assertEquals(rotated, f.vault.get(VaultKeys.REFRESH_TOKEN)?.toString(Charsets.UTF_8))
                coordinator.onResponse(access, 200)
                coEvery { f.auth.refresh(RefreshBody(rotated)) } returns
                    ApiResult.Failure.Problem(
                        ProblemDetail(title = "Expired", status = 401, code = "auth.refresh_invalid"),
                    )
                assertNull(coordinator.refresh(access))
                assertEquals(SessionState.SignedOut(SignOutReason.REFRESH_INVALID), f.manager.state.value)
                assertTrue(f.vault.keys().isEmpty())
                coVerify(exactly = 0) { f.auth.logout() }
            } finally {
                f.close()
            }
        }
}
