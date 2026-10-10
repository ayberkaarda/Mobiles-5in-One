package app.cetele.android.feature.ledger.entry

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.media.CompressedPhoto
import app.cetele.android.core.data.media.CompressionPlan
import app.cetele.android.core.data.media.ImageCompressor
import app.cetele.android.core.data.repository.LedgerRepository
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.data.write.EntryDraft
import app.cetele.android.core.data.write.WriteResult
import app.cetele.android.core.domain.format.MoneyFormat
import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.core.domain.time.CeteleClock
import app.cetele.android.core.domain.validation.EntryValidator
import app.cetele.android.core.domain.validation.FieldCodes
import app.cetele.android.core.domain.validation.FieldError
import app.cetele.android.core.domain.validation.Limits
import app.cetele.android.feature.ledger.photo.PhotoCapture
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.File
import java.io.IOException
import java.time.Clock
import java.time.LocalDate
import javax.inject.Inject

@HiltViewModel
// Each form action has its own event method so the screen can bind it directly.
@Suppress("TooManyFunctions")
class EntryEditViewModel
    @Inject
    constructor(
        handle: SavedStateHandle,
        private val ledger: LedgerRepository,
        shops: ShopRepository,
        private val compressor: ImageCompressor,
        private val clock: Clock,
    ) : ViewModel() {
        private val mutableState =
            MutableStateFlow(
                EntryEditState(
                    customerId = requireNotNull(handle["customerId"]),
                    type = EntryType.valueOf(requireNotNull(handle.get<String>("type"))),
                    occurredOn = CeteleClock.today(clock),
                ),
            )
        val state = mutableState.asStateFlow()

        init {
            viewModelScope.launch {
                shops.observeActive().collect { shop ->
                    mutableState.update { it.copy(shopId = shop?.id) }
                }
            }
        }

        fun setAmount(value: Long) = edit { it.copy(amountMinor = value) }

        fun setAmountText(text: String) {
            val minor = MoneyFormat.parse(text)
            edit {
                it.copy(
                    amountMinor = minor ?: 0,
                    errors = if (minor == null) amountError() else emptyList(),
                )
            }
        }

        fun setType(type: EntryType) =
            edit {
                it.copy(type = type, dueOn = it.dueOn.takeIf { type == EntryType.DEBT })
            }

        fun setOccurredOn(date: LocalDate) = edit { it.copy(occurredOn = date) }

        fun setDueOn(date: LocalDate?) =
            edit {
                it.copy(dueOn = if (it.type == EntryType.DEBT) date else null)
            }

        fun setNote(note: String) = edit { it.copy(note = note) }

        fun removePhoto() = edit { it.copy(photo = null, photoFailed = false) }

        fun acceptPhoto(photo: CompressedPhoto) {
            val valid =
                photo.bytes.size in 1..Limits.PHOTO_MAX_BYTES &&
                    photo.width in 1..Limits.PHOTO_MAX_SIDE && photo.height in 1..Limits.PHOTO_MAX_SIDE
            edit { it.copy(photo = photo.takeIf { valid }, photoFailed = !valid) }
        }

        fun photoPlan(
            width: Int,
            height: Int,
            bytes: Int,
        ) = CompressionPlan.steps(width, height, bytes)

        fun captureFailed() = edit { it.copy(photoFailed = true) }

        fun compressCapture(file: File) {
            if (state.value.busy || state.value.photoBusy) {
                // The capture is plain JPEG in the cache; never leave it behind unencrypted.
                PhotoCapture.discard(file)
                return
            }
            mutableState.update { it.copy(photoBusy = true, photoFailed = false) }
            viewModelScope.launch {
                try {
                    val photo = compressor.compress(file)
                    mutableState.update { it.copy(photo = photo) }
                } catch (_: IOException) {
                    mutableState.update { it.copy(photoFailed = true) }
                } catch (_: IllegalArgumentException) {
                    mutableState.update { it.copy(photoFailed = true) }
                } catch (_: IllegalStateException) {
                    mutableState.update { it.copy(photoFailed = true) }
                } finally {
                    mutableState.update { it.copy(photoBusy = false) }
                }
            }
        }

        fun save() {
            val current = state.value
            if (current.busy || current.photoBusy || current.savedId != null) return
            val errors =
                EntryValidator.validate(
                    current.type,
                    current.amountMinor,
                    current.occurredOn,
                    current.dueOn,
                    current.note,
                    null,
                    null,
                    CeteleClock.today(clock),
                )
            val shopId = current.shopId
            mutableState.update { it.copy(errors = errors, writeFailed = shopId == null) }
            if (shopId != null && errors.isEmpty()) write(shopId, current)
        }

        private fun write(
            shopId: String,
            current: EntryEditState,
        ) {
            mutableState.update { it.copy(busy = true) }
            viewModelScope.launch {
                try {
                    val draft =
                        EntryDraft(
                            current.customerId,
                            current.type,
                            current.amountMinor,
                            current.occurredOn,
                            current.dueOn,
                            current.note.takeIf { it.isNotBlank() },
                        )
                    when (val result = ledger.create(shopId, draft, current.photo)) {
                        is WriteResult.Ok -> mutableState.update { it.copy(savedId = result.id, photo = null) }
                        is WriteResult.Invalid -> mutableState.update { it.copy(errors = result.errors) }
                    }
                } catch (_: IOException) {
                    mutableState.update { it.copy(writeFailed = true) }
                } catch (_: IllegalStateException) {
                    mutableState.update { it.copy(writeFailed = true) }
                } finally {
                    mutableState.update { it.copy(busy = false) }
                }
            }
        }

        private fun edit(change: (EntryEditState) -> EntryEditState) {
            if (state.value.busy || state.value.photoBusy || state.value.savedId != null) return
            mutableState.update { change(it.copy(errors = emptyList(), writeFailed = false)) }
        }

        private fun amountError() = listOf(FieldError("entry.amountMinor", FieldCodes.OUT_OF_RANGE))
    }
