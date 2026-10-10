package app.cetele.android.feature.ledger.entry

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.media.PhotoRepository
import app.cetele.android.core.data.repository.LedgerRepository
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.data.write.WriteResult
import app.cetele.android.core.domain.model.LedgerEntry
import app.cetele.android.core.domain.time.CeteleClock
import app.cetele.android.core.domain.validation.FieldError
import app.cetele.android.feature.ledger.photo.EntryPhotoStatus
import app.cetele.android.feature.ledger.photo.EntryPhotos
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.IOException
import java.time.Clock
import javax.inject.Inject

data class EntryDetailState(
    val entry: LedgerEntry? = null,
    val loading: Boolean = true,
    val photoStatus: EntryPhotoStatus = EntryPhotoStatus.Absent,
    val confirmReversal: Boolean = false,
    val busy: Boolean = false,
    val failed: Boolean = false,
    val errors: List<FieldError> = emptyList(),
)

@HiltViewModel
class EntryDetailViewModel
    @Inject
    constructor(
        handle: SavedStateHandle,
        private val ledger: LedgerRepository,
        shops: ShopRepository,
        private val photos: EntryPhotos,
        private val clock: Clock,
        val photoRepository: PhotoRepository,
    ) : ViewModel() {
        private val entryId = requireNotNull(handle.get<String>("entryId"))
        private val mutableState = MutableStateFlow(EntryDetailState())
        val state = mutableState.asStateFlow()

        init {
            viewModelScope.launch {
                shops.observeActive().collectLatest { shop ->
                    mutableState.value = EntryDetailState(loading = shop != null)
                    if (shop != null) {
                        ledger.observeAll(shop.id).collectLatest { entries ->
                            val entry = entries.firstOrNull { it.id == entryId }
                            if (entry == null) {
                                mutableState.update {
                                    it.copy(entry = null, loading = false, photoStatus = EntryPhotoStatus.Absent)
                                }
                            } else {
                                photos.observe(entry).collect { photoStatus ->
                                    mutableState.update {
                                        it.copy(entry = entry, loading = false, photoStatus = photoStatus)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        fun requestReversal() {
            if (state.value.entry?.countsTowardBalance == true && !state.value.busy) {
                mutableState.update { it.copy(confirmReversal = true, errors = emptyList(), failed = false) }
            }
        }

        fun dismissReversal() {
            if (!state.value.busy) mutableState.update { it.copy(confirmReversal = false) }
        }

        fun confirmReversal() {
            val current = state.value
            val entry = current.entry ?: return
            if (!current.confirmReversal || current.busy || !entry.countsTowardBalance) return
            performWrite {
                when (val result = ledger.reverse(entry.shopId, entry.id, CeteleClock.today(clock))) {
                    is WriteResult.Ok -> {
                        val refreshed = ledger.get(entry.shopId, entry.id)
                        mutableState.update { it.copy(entry = refreshed, confirmReversal = false) }
                    }

                    is WriteResult.Invalid -> {
                        mutableState.update {
                            it.copy(errors = result.errors, confirmReversal = false)
                        }
                    }
                }
            }
        }

        /** Only offered after a failed upload; the entry then leaves through the outbox without its photo. */
        fun sendWithoutPhoto() {
            val current = state.value
            val entry = current.entry ?: return
            if (current.photoStatus != EntryPhotoStatus.Failed || current.busy) return
            performWrite { photos.sendWithoutPhoto(entry) }
        }

        private fun performWrite(write: suspend () -> Unit) {
            mutableState.update { it.copy(busy = true, failed = false) }
            viewModelScope.launch {
                try {
                    write()
                } catch (_: IOException) {
                    mutableState.update { it.copy(failed = true) }
                } catch (_: IllegalStateException) {
                    mutableState.update { it.copy(failed = true) }
                } finally {
                    mutableState.update { it.copy(busy = false) }
                }
            }
        }
    }
