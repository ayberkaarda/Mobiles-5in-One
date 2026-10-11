package app.cetele.android.feature.export.backup

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.backup.BackupExportResult
import app.cetele.android.core.data.backup.BackupFormat
import app.cetele.android.core.data.backup.BackupMergeResult
import app.cetele.android.core.data.backup.BackupOpenResult
import app.cetele.android.core.data.backup.BackupService
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.domain.time.CeteleClock
import app.cetele.android.feature.export.ExportAttachment
import app.cetele.android.feature.export.R
import app.cetele.android.feature.export.share.ExportFiles
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException
import java.time.Clock
import javax.inject.Inject

/**
 * Owner-only `.cetele` backup flow. The passphrase arrives per call, is copied into a char array
 * for the service and wiped afterwards; it is never stored in state, saved state or logs.
 */
@Suppress("TooManyFunctions")
@HiltViewModel
class BackupViewModel
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
        private val shops: ShopRepository,
        private val backups: BackupService,
        private val clock: Clock,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(BackupUiState())
        val state = mutableState.asStateFlow()
        private val attachments = Channel<ExportAttachment>(Channel.BUFFERED)
        val shares = attachments.receiveAsFlow()
        private val files = ExportFiles(context.cacheDir)
        private var file: ByteArray? = null

        init {
            viewModelScope.launch {
                combine(shops.observeShops(), shops.observeActive()) { all, active -> all to active?.id }
                    .collect { (all, active) -> ownedShops(all, active) }
            }
        }

        /** Only owned shops are offered; losing the owner role drops the shop and its open preview. */
        private fun ownedShops(
            all: List<Shop>,
            active: String?,
        ) {
            val owned = all.filter { it.role == ShopRole.OWNER }
            mutableState.update { current ->
                val keep = current.selectedShopId?.takeIf { id -> owned.any { it.id == id } }
                val preferred = active?.takeIf { id -> owned.any { it.id == id } }
                val preview = current.preview?.takeIf { p -> owned.any { it.id == p.shopId } }
                current.copy(
                    loading = false,
                    shops = owned,
                    selectedShopId = keep ?: preferred ?: owned.firstOrNull()?.id,
                    preview = preview,
                )
            }
        }

        fun select(shopId: String) {
            if (state.value.shops.any { it.id == shopId }) {
                mutableState.update { it.copy(selectedShopId = shopId, exported = null, errorRes = null) }
            }
        }

        fun export(
            passphrase: String,
            confirm: String,
        ) {
            val current = state.value
            val shop = current.shops.firstOrNull { it.id == current.selectedShopId }
            val invalid = BackupRules.passphraseError(passphrase, confirm)
            if (shop == null || current.busy || invalid != null) {
                if (invalid != null) mutableState.update { it.copy(passphraseError = invalid, exported = null) }
                return
            }
            mutableState.update { it.copy(busy = true, passphraseError = null, errorRes = null, exported = null) }
            val secret = passphrase.toCharArray()
            viewModelScope.launch {
                try {
                    when (val result = backups.export(shop.id, secret)) {
                        is BackupExportResult.Ok -> deliver(shop, result)
                        is BackupExportResult.Failed -> fail(BackupRules.problemText(result.problem))
                    }
                } catch (error: CancellationException) {
                    throw error
                } catch (ignored: IOException) {
                    fail(R.string.export_common_error)
                } catch (ignored: IllegalArgumentException) {
                    fail(R.string.export_common_error)
                } finally {
                    secret.fill(Char.MIN_VALUE)
                    mutableState.update { it.copy(busy = false) }
                }
            }
        }

        private suspend fun deliver(
            shop: Shop,
            result: BackupExportResult.Ok,
        ) {
            val target =
                withContext(Dispatchers.IO) {
                    val destination = files.backup(result.shopName, CeteleClock.today(clock))
                    var complete = false
                    try {
                        destination.outputStream().use { it.write(result.bytes) }
                        complete = true
                        destination
                    } finally {
                        if (!complete) destination.delete()
                    }
                }
            if (state.value.shops.none { it.id == shop.id }) {
                target.delete()
                fail(R.string.export_backup_owner_only)
                return
            }
            mutableState.update { it.copy(exported = ExportedCounts(result.customers, result.entries)) }
            attachments.send(ExportAttachment(target, BackupRules.MIME))
        }

        fun sharingFailed() {
            fail(R.string.export_common_error)
        }

        fun fileSelected(uri: Uri) {
            if (state.value.busy || state.value.shops.isEmpty()) return
            mutableState.update { it.copy(busy = true, errorRes = null) }
            viewModelScope.launch {
                val bytes =
                    try {
                        withContext(Dispatchers.IO) {
                            context.contentResolver.openInputStream(uri)?.use {
                                BackupRules.readCapped(it, BackupFormat.MAX_FILE_BYTES)
                            }
                        }
                    } catch (error: CancellationException) {
                        throw error
                    } catch (ignored: IOException) {
                        null
                    } catch (ignored: SecurityException) {
                        null
                    }
                fileLoaded(bytes)
            }
        }

        internal fun fileLoaded(bytes: ByteArray?) {
            file = bytes
            mutableState.update {
                it.copy(
                    busy = false,
                    fileLoaded = bytes != null,
                    preview = null,
                    imported = null,
                    errorRes = if (bytes == null) R.string.export_restore_unreadable else null,
                )
            }
        }

        fun open(passphrase: String) {
            val bytes = file ?: return
            if (state.value.busy || state.value.shops.isEmpty()) return
            mutableState.update { it.copy(busy = true, errorRes = null) }
            val secret = passphrase.toCharArray()
            viewModelScope.launch {
                try {
                    when (val result = backups.open(bytes, secret)) {
                        is BackupOpenResult.Ok -> {
                            val owned = state.value.shops.any { it.id == result.preview.shopId }
                            if (owned) {
                                mutableState.update { it.copy(preview = result.preview) }
                            } else {
                                fail(R.string.export_backup_owner_only)
                            }
                        }

                        is BackupOpenResult.Failed -> {
                            fail(BackupRules.problemText(result.problem))
                        }
                    }
                } finally {
                    secret.fill(Char.MIN_VALUE)
                    mutableState.update { it.copy(busy = false) }
                }
            }
        }

        fun confirmImport() {
            val preview = state.value.preview ?: return
            if (state.value.busy || state.value.shops.none { it.id == preview.shopId }) return
            mutableState.update { it.copy(busy = true, errorRes = null) }
            viewModelScope.launch {
                try {
                    when (val result = backups.merge(preview)) {
                        is BackupMergeResult.Ok -> {
                            file = null
                            mutableState.update {
                                it.copy(imported = result, preview = null, fileLoaded = false)
                            }
                        }

                        is BackupMergeResult.Failed -> {
                            fail(BackupRules.problemText(result.problem))
                        }
                    }
                } finally {
                    mutableState.update { it.copy(busy = false) }
                }
            }
        }

        fun cancelImport() {
            file = null
            mutableState.update { it.copy(fileLoaded = false, preview = null, imported = null, errorRes = null) }
        }

        private fun fail(message: Int) {
            mutableState.update { it.copy(errorRes = message) }
        }
    }
