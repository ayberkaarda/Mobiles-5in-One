package app.cetele.android.feature.shop.join

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.network.ApiResult
import app.cetele.android.feature.shop.ShopFailure
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class JoinShopState(
    val code: String = "",
    val invalidCode: Boolean = false,
    val busy: Boolean = false,
    val completedShopId: String? = null,
    val failure: ShopFailure? = null,
)

@HiltViewModel
class JoinShopViewModel
    @Inject
    constructor(
        private val shops: ShopRepository,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(JoinShopState())
        val state = mutableState.asStateFlow()

        fun change(code: String) {
            if (!state.value.busy) mutableState.value = JoinShopState(code)
        }

        fun submit() {
            val current = state.value
            if (current.busy || current.completedShopId != null) return
            val code = current.code.trim()
            if (code.length != CODE_LENGTH || code.any { !it.isLetterOrDigit() || it.code > ASCII_END }) {
                mutableState.value = current.copy(invalidCode = true, failure = null)
                return
            }
            mutableState.value = current.copy(busy = true, failure = null, invalidCode = false)
            viewModelScope.launch {
                when (val result = shops.join(code)) {
                    is ApiResult.Success -> {
                        shops.setActive(result.value.id)
                        mutableState.value = state.value.copy(busy = false, completedShopId = result.value.id)
                    }

                    is ApiResult.Failure -> {
                        mutableState.value =
                            state.value.copy(busy = false, failure = ShopFailure.from(result, joining = true))
                    }
                }
            }
        }

        private companion object {
            const val CODE_LENGTH = 8
            const val ASCII_END = 127
        }
    }
