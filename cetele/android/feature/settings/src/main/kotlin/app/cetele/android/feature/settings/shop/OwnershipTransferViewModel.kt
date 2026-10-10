package app.cetele.android.feature.settings.shop

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.AuthApi
import app.cetele.android.core.network.api.ShopsApi
import app.cetele.android.core.network.dto.shops.MemberView
import app.cetele.android.core.network.dto.shops.OwnershipBody
import app.cetele.android.core.network.dto.shops.OwnershipReceipt
import app.cetele.android.feature.settings.account.validCode
import app.cetele.android.feature.settings.common.SettingsError
import app.cetele.android.feature.settings.common.error
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

data class OwnershipTransferState(
    val members: List<MemberView> = emptyList(),
    val selectedUserId: String? = null,
    val busy: Boolean = false,
    val codeSent: Boolean = false,
    val receipt: OwnershipReceipt? = null,
    val error: SettingsError? = null,
)

@HiltViewModel
class OwnershipTransferViewModel
    @Inject
    constructor(
        private val auth: AuthApi,
        private val api: ShopsApi,
        private val shops: ShopRepository,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(OwnershipTransferState())
        val state = mutableState.asStateFlow()
        private var shopId: String? = null

        fun load() =
            viewModelScope.launch {
                if (state.value.busy) return@launch
                val shop = shops.observeActive().first()
                if (shop?.role != ShopRole.OWNER) {
                    mutableState.value = state.value.copy(error = SettingsError("forbidden"))
                    return@launch
                }
                shopId = shop.id
                mutableState.value = state.value.copy(busy = true)
                when (val result = api.members(shop.id)) {
                    is ApiResult.Success -> {
                        mutableState.value =
                            state.value.copy(
                                members =
                                    result.value.members.filter {
                                        it.role ==
                                            app.cetele.android.core.network.dto.ShopRole.STAFF
                                    },
                                selectedUserId = null,
                                error = null,
                            )
                    }

                    is ApiResult.Failure -> {
                        mutableState.value = state.value.copy(error = result.error())
                    }
                }
                mutableState.value = state.value.copy(busy = false)
            }

        fun select(userId: String) {
            if (!state.value.busy && state.value.members.any { it.userId == userId }) {
                mutableState.value = state.value.copy(selectedUserId = userId)
            }
        }

        fun requestCode() =
            viewModelScope.launch {
                if (state.value.busy || shopId == null) return@launch
                mutableState.value = state.value.copy(busy = true, error = null)
                val result = auth.requestReauth()
                mutableState.value =
                    state.value.copy(busy = false, codeSent = result is ApiResult.Success, error = result.error())
            }

        fun transfer(code: String) =
            viewModelScope.launch {
                val id = shopId ?: return@launch
                val target = state.value.selectedUserId ?: return@launch
                if (state.value.busy || !state.value.codeSent) return@launch
                if (!validCode(code)) {
                    mutableState.value = state.value.copy(error = SettingsError("auth.reauth_invalid"))
                    return@launch
                }
                if (shops.observeActive().first()?.let { it.id == id && it.role == ShopRole.OWNER } != true) {
                    mutableState.value = state.value.copy(error = SettingsError("forbidden"))
                    return@launch
                }
                mutableState.value = state.value.copy(busy = true, error = null)
                when (val result = api.transferOwnership(id, OwnershipBody(target, code))) {
                    is ApiResult.Success -> {
                        mutableState.value = state.value.copy(receipt = result.value, codeSent = false)
                        mutableState.value = state.value.copy(error = shops.refresh().error())
                    }

                    is ApiResult.Failure -> {
                        mutableState.value = state.value.copy(error = result.error())
                    }
                }
                mutableState.value = state.value.copy(busy = false)
            }
    }
