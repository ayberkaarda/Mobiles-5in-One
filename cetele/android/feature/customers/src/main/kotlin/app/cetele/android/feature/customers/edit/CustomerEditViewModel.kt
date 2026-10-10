package app.cetele.android.feature.customers.edit

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.repository.CustomerRepository
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.data.write.WriteResult
import app.cetele.android.core.domain.model.ConsentSource
import app.cetele.android.core.domain.time.CeteleClock
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Clock
import java.time.LocalDate
import javax.inject.Inject

@HiltViewModel
class CustomerEditViewModel
    @Inject
    constructor(
        savedStateHandle: SavedStateHandle,
        private val customers: CustomerRepository,
        private val shops: ShopRepository,
        private val clock: Clock,
    ) : ViewModel() {
        private val customerId = savedStateHandle.get<String>("customerId")
        private var shopId: String? = null
        private val mutableState = MutableStateFlow(CustomerEditState(consentDate = CeteleClock.today(clock)))
        val state = mutableState.asStateFlow()

        init {
            viewModelScope.launch { load() }
        }

        private suspend fun load() {
            val shop = shops.observeActive().first()
            shopId = shop?.id
            if (shop == null) {
                mutableState.update { it.copy(loading = false, problemCode = "not_found") }
            } else if (customerId == null) {
                mutableState.update { it.copy(loading = false, available = true) }
            } else {
                val customer = customers.observe(shop.id, customerId).first()
                if (customer == null || customer.deletedAt != null) {
                    mutableState.update { it.copy(loading = false, problemCode = "customer.deleted") }
                } else {
                    mutableState.value =
                        CustomerEditState(
                            name = customer.name,
                            phone = customer.phone.orEmpty(),
                            note = customer.note.orEmpty(),
                            tag = customer.tag.orEmpty(),
                            smsConsent = customer.smsConsent,
                            consentDate =
                                customer.smsConsentAt?.atZone(CeteleClock.ZONE)?.toLocalDate()
                                    ?: CeteleClock.today(clock),
                            consentSource = customer.smsConsentSource,
                            originalConsentAt = customer.smsConsentAt,
                            loading = false,
                            available = true,
                        )
                }
            }
        }

        fun changeText(
            field: CustomerTextField,
            value: String,
        ) = change {
            when (field) {
                CustomerTextField.Name -> it.copy(name = value)
                CustomerTextField.Phone -> it.copy(phone = value)
                CustomerTextField.Note -> it.copy(note = value)
                CustomerTextField.Tag -> it.copy(tag = value)
            }
        }

        fun changeConsent(value: Boolean) =
            change {
                it.copy(
                    smsConsent = value,
                    originalConsentAt = null,
                    consentSource = null,
                    consentDate = CeteleClock.today(clock),
                )
            }

        fun changeSource(value: ConsentSource) = change { it.copy(consentSource = value) }

        fun changeDate(value: LocalDate) = change { it.copy(consentDate = value, originalConsentAt = null) }

        private fun change(transform: (CustomerEditState) -> CustomerEditState) {
            if (!state.value.saving && state.value.available) {
                mutableState.update { transform(it).copy(errors = emptyList(), problemCode = null) }
            }
        }

        fun save() {
            val current = state.value
            val targetShop = shopId
            if (targetShop == null || !current.canSave()) return
            val errors = current.validationErrors(customerId)
            if (errors.isNotEmpty()) {
                mutableState.update { it.copy(errors = errors) }
            } else {
                mutableState.update { it.copy(saving = true, problemCode = null) }
                viewModelScope.launch { persist(targetShop, current) }
            }
        }

        private fun CustomerEditState.canSave(): Boolean = available && !saving && savedId == null

        private suspend fun persist(
            targetShop: String,
            current: CustomerEditState,
        ) {
            try {
                if (shops.observeActive().first()?.id != targetShop) {
                    mutableState.update { it.copy(available = false, problemCode = "not_found") }
                } else {
                    when (val result = customers.save(targetShop, current.draft(customerId))) {
                        is WriteResult.Ok -> mutableState.update { it.copy(savedId = result.id) }
                        is WriteResult.Invalid -> mutableState.update { it.copy(errors = result.errors) }
                    }
                }
            } finally {
                mutableState.update { it.copy(saving = false) }
            }
        }
    }
