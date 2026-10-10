package app.cetele.android.feature.settings.account

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.domain.validation.Limits
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.AuthApi
import app.cetele.android.core.network.api.MeApi
import app.cetele.android.core.network.dto.me.AccountDeletionBody
import app.cetele.android.core.network.dto.me.AccountDeletionReceipt
import app.cetele.android.feature.settings.common.SettingsError
import app.cetele.android.feature.settings.common.error
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AccountDeletionState(
    val busy: Boolean = false,
    val codeSent: Boolean = false,
    val sharedShopChoice: Boolean = false,
    val receipt: AccountDeletionReceipt? = null,
    val error: SettingsError? = null,
)

@HiltViewModel
class AccountDeletionViewModel
    @Inject
    constructor(
        private val auth: AuthApi,
        private val me: MeApi,
        private val shops: ShopRepository,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(AccountDeletionState())
        val state = mutableState.asStateFlow()

        fun requestCode() =
            viewModelScope.launch {
                if (state.value.busy) return@launch
                mutableState.value = state.value.copy(busy = true, error = null, sharedShopChoice = false)
                val result = auth.requestReauth()
                mutableState.value =
                    state.value.copy(
                        busy = false,
                        codeSent = result is ApiResult.Success,
                        error = result.error(),
                    )
            }

        fun delete(
            code: String,
            deleteOwnedShops: Boolean = false,
        ) = viewModelScope.launch {
            if (state.value.busy || !state.value.codeSent) return@launch
            if (!validCode(code)) {
                mutableState.value = state.value.copy(error = SettingsError("auth.reauth_invalid"))
                return@launch
            }
            mutableState.value = state.value.copy(busy = true, error = null, sharedShopChoice = false)
            when (val result = me.deleteAccount(AccountDeletionBody(code, deleteOwnedShops))) {
                is ApiResult.Success -> {
                    mutableState.value = state.value.copy(receipt = result.value, codeSent = false)
                    val refresh = shops.refresh()
                    mutableState.value = state.value.copy(error = refresh.error())
                }

                is ApiResult.Failure -> {
                    mutableState.value =
                        state.value.copy(
                            error = result.error(),
                            sharedShopChoice = result.problemCode == "account.owner_of_shared_shop",
                        )
                }
            }
            mutableState.value = state.value.copy(busy = false)
        }

        fun dismissChoice() {
            mutableState.value = state.value.copy(sharedShopChoice = false)
        }
    }

internal fun validCode(code: String): Boolean = code.length == Limits.OTP_LENGTH && code.all { it in '0'..'9' }
