package app.cetele.android.feature.export

import android.content.Context
import androidx.lifecycle.ViewModelStore
import app.cetele.android.core.data.backup.BackupExportResult
import app.cetele.android.core.data.backup.BackupMergeResult
import app.cetele.android.core.data.backup.BackupOpenResult
import app.cetele.android.core.data.backup.BackupPreview
import app.cetele.android.core.data.backup.BackupProblem
import app.cetele.android.core.data.backup.BackupService
import app.cetele.android.core.data.backup.BackupSnapshot
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.feature.export.backup.BackupRules
import app.cetele.android.feature.export.backup.BackupViewModel
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.api.io.TempDir
import java.io.ByteArrayInputStream
import java.io.IOException
import java.nio.file.Path
import java.time.Clock
import java.time.ZoneOffset

@OptIn(ExperimentalCoroutinesApi::class)
class BackupViewModelTest {
    @TempDir
    lateinit var cache: Path
    private val dispatcher = StandardTestDispatcher()
    private val store = ViewModelStore()
    private val shops = mockk<ShopRepository>()
    private val backups = mockk<BackupService>()
    private val staffShop = shop.copy(id = "shop-2", name = "Köşe Büfe", role = ShopRole.STAFF)
    private val all = MutableStateFlow(listOf(shop, staffShop))
    private val passphrase = "uzun bir parola"
    private val fileBytes = byteArrayOf(1, 2, 3)

    @BeforeEach
    fun setup() {
        Dispatchers.setMain(dispatcher)
        every { shops.observeShops() } returns all
        every { shops.observeActive() } returns MutableStateFlow(staffShop)
    }

    @AfterEach
    fun cleanup() {
        store.clear()
        Dispatchers.resetMain()
    }

    @Test
    fun onlyOwnedShopsAreOfferedAndAStaffShopCannotBeSelected() =
        runTest(dispatcher) {
            val model = model()
            advanceUntilIdle()
            assertEquals(listOf(shop), model.state.value.shops)
            assertEquals(shop.id, model.state.value.selectedShopId)
            model.select(staffShop.id)
            assertEquals(shop.id, model.state.value.selectedShopId)
        }

    @Test
    fun staffOnlyUserCanNeitherExportNorOpenNorImport() =
        runTest(dispatcher) {
            all.value = listOf(staffShop)
            val model = model()
            advanceUntilIdle()
            model.export(passphrase, passphrase)
            model.fileLoaded(fileBytes)
            model.open(passphrase)
            model.confirmImport()
            advanceUntilIdle()
            assertTrue(
                model.state.value.shops
                    .isEmpty(),
            )
            coVerify(exactly = 0) { backups.export(any(), any()) }
            coVerify(exactly = 0) { backups.open(any(), any()) }
            coVerify(exactly = 0) { backups.merge(any()) }
        }

    @Test
    fun passphraseMustBeLongEnoughAndTypedTwice() =
        runTest(dispatcher) {
            val model = model()
            advanceUntilIdle()
            model.export("kısa", "kısa")
            assertEquals(R.string.export_backup_passphrase_short, model.state.value.passphraseError)
            model.export(passphrase, "$passphrase!")
            assertEquals(R.string.export_backup_passphrase_mismatch, model.state.value.passphraseError)
            model.export("a".repeat(257), "a".repeat(257))
            assertEquals(R.string.export_backup_passphrase_long, model.state.value.passphraseError)
            advanceUntilIdle()
            coVerify(exactly = 0) { backups.export(any(), any()) }
        }

    @Test
    fun exportWritesACeteleFileSharesItAndWipesThePassphraseCopy() =
        runTest(dispatcher) {
            val secret = slot<CharArray>()
            coEvery { backups.export(shop.id, capture(secret)) } returns
                BackupExportResult.Ok(fileBytes, shop.name, 2, 5)
            val model = model()
            advanceUntilIdle()
            model.export(passphrase, passphrase)
            val attachment = model.shares.first()
            advanceUntilIdle()
            assertTrue(attachment.file.name.endsWith(".cetele"), attachment.file.name)
            assertTrue(attachment.file.name.startsWith("cetele-cinar-bakkali-"), attachment.file.name)
            assertTrue(attachment.file.canonicalPath.startsWith(cache.resolve("exports").toFile().canonicalPath))
            assertArrayEquals(fileBytes, attachment.file.readBytes())
            assertEquals(BackupRules.MIME, attachment.mime)
            assertEquals(
                2,
                model.state.value.exported
                    ?.customers,
            )
            assertEquals(
                5,
                model.state.value.exported
                    ?.entries,
            )
            assertFalse(model.state.value.busy)
            assertTrue(secret.captured.all { it == Char.MIN_VALUE })
        }

    @Test
    fun exportRefusalIsShownAndNothingIsShared() =
        runTest(dispatcher) {
            coEvery { backups.export(shop.id, any()) } returns BackupExportResult.Failed(BackupProblem.NOT_OWNER)
            val model = model()
            advanceUntilIdle()
            model.export(passphrase, passphrase)
            advanceUntilIdle()
            assertEquals(R.string.export_backup_owner_only, model.state.value.errorRes)
            assertNull(model.state.value.exported)
            assertFalse(cache.resolve("exports").toFile().exists())
        }

    @Test
    fun importShowsPreviewThenMergesOnConfirm() =
        runTest(dispatcher) {
            val preview = preview(shop.id)
            coEvery { backups.open(fileBytes, any()) } returns BackupOpenResult.Ok(preview)
            coEvery { backups.merge(preview) } returns BackupMergeResult.Ok(1, 3)
            val model = model()
            advanceUntilIdle()
            model.fileLoaded(fileBytes)
            assertTrue(model.state.value.fileLoaded)
            model.open(passphrase)
            advanceUntilIdle()
            assertEquals(preview, model.state.value.preview)
            coVerify(exactly = 0) { backups.merge(any()) }
            model.confirmImport()
            advanceUntilIdle()
            assertEquals(BackupMergeResult.Ok(1, 3), model.state.value.imported)
            assertNull(model.state.value.preview)
            assertFalse(model.state.value.fileLoaded)
        }

    @Test
    fun wrongPassphraseShowsAnErrorAndKeepsTheFileForAnotherTry() =
        runTest(dispatcher) {
            coEvery { backups.open(fileBytes, any()) } returns BackupOpenResult.Failed(BackupProblem.AUTHENTICATION)
            val model = model()
            advanceUntilIdle()
            model.fileLoaded(fileBytes)
            model.open("yanlış parola")
            advanceUntilIdle()
            assertEquals(R.string.export_restore_authentication, model.state.value.errorRes)
            assertNull(model.state.value.preview)
            assertTrue(model.state.value.fileLoaded)
            model.confirmImport()
            advanceUntilIdle()
            coVerify(exactly = 0) { backups.merge(any()) }
        }

    @Test
    fun everyProblemHasItsOwnMessage() {
        val texts = BackupProblem.entries.map(BackupRules::problemText)
        assertEquals(texts.size, texts.toSet().size)
    }

    @Test
    fun backupOfAShopTheUserDoesNotOwnIsRefusedBeforeMerge() =
        runTest(dispatcher) {
            coEvery { backups.open(fileBytes, any()) } returns BackupOpenResult.Ok(preview(staffShop.id))
            val model = model()
            advanceUntilIdle()
            model.fileLoaded(fileBytes)
            model.open(passphrase)
            advanceUntilIdle()
            model.confirmImport()
            advanceUntilIdle()
            assertNull(model.state.value.preview)
            assertEquals(R.string.export_backup_owner_only, model.state.value.errorRes)
            coVerify(exactly = 0) { backups.merge(any()) }
        }

    @Test
    fun losingTheOwnerRoleDropsAnOpenPreview() =
        runTest(dispatcher) {
            coEvery { backups.open(fileBytes, any()) } returns BackupOpenResult.Ok(preview(shop.id))
            val model = model()
            advanceUntilIdle()
            model.fileLoaded(fileBytes)
            model.open(passphrase)
            advanceUntilIdle()
            all.value = listOf(shop.copy(role = ShopRole.STAFF))
            advanceUntilIdle()
            assertNull(model.state.value.preview)
            model.confirmImport()
            advanceUntilIdle()
            coVerify(exactly = 0) { backups.merge(any()) }
        }

    @Test
    fun unreadableFileIsReportedAndCancelClearsTheFlow() =
        runTest(dispatcher) {
            val model = model()
            advanceUntilIdle()
            model.fileLoaded(null)
            assertEquals(R.string.export_restore_unreadable, model.state.value.errorRes)
            model.fileLoaded(fileBytes)
            model.cancelImport()
            model.open(passphrase)
            advanceUntilIdle()
            assertFalse(model.state.value.fileLoaded)
            coVerify(exactly = 0) { backups.open(any(), any()) }
        }

    @Test
    fun oversizedFilesAreRefusedRatherThanCut() {
        assertArrayEquals(ByteArray(10), BackupRules.readCapped(ByteArrayInputStream(ByteArray(10)), 10))
        assertThrows<IOException> { BackupRules.readCapped(ByteArrayInputStream(ByteArray(11)), 10) }
    }

    private fun preview(shopId: String): BackupPreview =
        BackupPreview(
            BackupSnapshot(
                shopId = shopId,
                shopName = shop.name,
                exportedAt = instant.toString(),
                customers = emptyList(),
                entries = emptyList(),
            ),
            newCustomers = 1,
            newEntries = 3,
        )

    private fun model(): BackupViewModel {
        val context = mockk<Context>()
        every { context.cacheDir } returns cache.toFile()
        return BackupViewModel(context, shops, backups, Clock.fixed(instant, ZoneOffset.UTC))
            .also { store.put("backup", it) }
    }
}
