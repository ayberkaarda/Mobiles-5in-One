package app.cetele.android.feature.settings.shop

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.AuthApi
import app.cetele.android.core.network.api.ShopsApi
import app.cetele.android.core.network.dto.shops.DeletionReceipt
import app.cetele.android.core.network.dto.shops.ReauthCode
import app.cetele.android.feature.settings.account.validCode
import app.cetele.android.feature.settings.common.SettingsError
import app.cetele.android.feature.settings.common.error
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ShopDeletionState(
    val busy: Boolean = false,
    val codeSent: Boolean = false,
    val receipt: DeletionReceipt? = null,
    val error: SettingsError? = null,
)

@HiltViewModel
class ShopDeletionViewModel
    @Inject
    constructor(
        private val auth: AuthApi,
        private val api: ShopsApi,
        private val shops: ShopRepository,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(ShopDeletionState())
        val state = mutableState.asStateFlow()

        fun requestCode() =
            viewModelScope.launch {
                if (state.value.busy) return@launch
                mutableState.value = state.value.copy(busy = true, error = null)
                val result = auth.requestReauth()
                mutableState.value =
                    state.value.copy(busy = false, codeSent = result is ApiResult.Success, error = result.error())
            }

        fun delete(code: String) =
            viewModelScope.launch {
                if (state.value.busy || !state.value.codeSent) return@launch
                val shop = shops.observeActive().first()
                if (shop?.role != ShopRole.OWNER) {
                    mutableState.value = state.value.copy(error = SettingsError("forbidden"))
                    return@launch
                }
                if (!validCode(code)) {
                    mutableState.value = state.value.copy(error = SettingsError("auth.reauth_invalid"))
                    return@launch
                }
                mutableState.value = state.value.copy(busy = true, error = null)
                when (val result = api.deleteShop(shop.id, ReauthCode(code))) {
                    is ApiResult.Success -> {
                        mutableState.value =
                            state.value.copy(receipt = result.value, codeSent = false)
                    }

                    is ApiResult.Failure -> {
                        mutableState.value = state.value.copy(error = result.error())
                    }
                }
                mutableState.value = state.value.copy(busy = false)
            }

        fun cancel() =
            viewModelScope.launch {
                if (state.value.busy) return@launch
                val shop = shops.observeActive().first() ?: return@launch
                if (shop.role != ShopRole.OWNER) return@launch
                mutableState.value = state.value.copy(busy = true)
                val result = api.cancelShopDeletion(shop.id)
                mutableState.value =
                    state.value.copy(
                        busy = false,
                        receipt = if (result is ApiResult.Success) null else state.value.receipt,
                        error = result.error(),
                    )
            }
    }
