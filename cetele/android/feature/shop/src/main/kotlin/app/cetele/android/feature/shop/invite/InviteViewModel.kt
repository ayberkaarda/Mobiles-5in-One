package app.cetele.android.feature.shop.invite

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.domain.format.PhoneFormat
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.ShopsApi
import app.cetele.android.core.network.dto.shops.CreateInvitationRequest
import app.cetele.android.core.network.dto.shops.IssuedInvitation
import app.cetele.android.feature.shop.ShopFailure
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class InviteState(
    val phone: String = "",
    val invalidPhone: Boolean = false,
    val role: ShopRole? = null,
    val busy: Boolean = false,
    val invitation: IssuedInvitation? = null,
    val failure: ShopFailure? = null,
)

@HiltViewModel
class InviteViewModel
    @Inject
    constructor(
        private val shops: ShopRepository,
        private val api: ShopsApi,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(InviteState())
        val state = mutableState.asStateFlow()
        private var shopId: String? = null
        private var screenVersion = 0L

        init {
            viewModelScope.launch {
                shops.observeActive().collect { shop ->
                    if (shopId != shop?.id || shop?.role != ShopRole.OWNER) {
                        screenVersion++
                        mutableState.value = InviteState(role = shop?.role)
                    } else {
                        mutableState.value = state.value.copy(role = ShopRole.OWNER)
                    }
                    shopId = shop?.id
                }
            }
        }

        fun change(phone: String) {
            if (!state.value.busy && state.value.invitation == null) {
                mutableState.value = state.value.copy(phone = phone, invalidPhone = false, failure = null)
            }
        }

        fun leaveScreen() {
            screenVersion++
            mutableState.value = InviteState(role = state.value.role)
        }

        fun submit() {
            val id = shopId
            val current = state.value
            val allowed = current.role == ShopRole.OWNER && !current.busy && current.invitation == null
            if (id == null || !allowed) return
            val phone = PhoneFormat.toE164Tr(current.phone)
            if (phone == null) {
                mutableState.value = current.copy(invalidPhone = true)
                return
            }
            mutableState.value = current.copy(busy = true, failure = null)
            val version = screenVersion
            viewModelScope.launch {
                val result = api.invite(id, CreateInvitationRequest(phone))
                if (version == screenVersion && shopId == id && state.value.role == ShopRole.OWNER) {
                    mutableState.value =
                        when (result) {
                            is ApiResult.Success -> state.value.copy(busy = false, invitation = result.value)
                            is ApiResult.Failure -> state.value.copy(busy = false, failure = ShopFailure.from(result))
                        }
                }
            }
        }
    }
