package app.cetele.android.feature.shop.create

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.network.ApiResult
import app.cetele.android.feature.shop.ShopFailure
import app.cetele.android.feature.shop.ShopForm
import app.cetele.android.feature.shop.ShopFormState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class CreateShopViewModel
    @Inject
    constructor(
        private val shops: ShopRepository,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(ShopFormState())
        val state = mutableState.asStateFlow()

        fun change(form: ShopForm) {
            if (!state.value.busy) mutableState.value = ShopFormState(form)
        }

        fun submit() {
            val current = state.value
            if (current.busy || current.completedShopId != null) return
            val errors = current.form.errors()
            mutableState.value = current.copy(errors = errors, failure = null)
            if (errors.isNotEmpty()) return
            mutableState.value = state.value.copy(busy = true)
            viewModelScope.launch {
                when (val result = shops.create(current.form.request())) {
                    is ApiResult.Success -> {
                        shops.setActive(result.value.id)
                        mutableState.value = state.value.copy(busy = false, completedShopId = result.value.id)
                    }

                    is ApiResult.Failure -> {
                        val failure = ShopFailure.from(result)
                        mutableState.value = state.value.copy(busy = false, failure = failure, errors = failure.fields)
                    }
                }
            }
        }
    }
