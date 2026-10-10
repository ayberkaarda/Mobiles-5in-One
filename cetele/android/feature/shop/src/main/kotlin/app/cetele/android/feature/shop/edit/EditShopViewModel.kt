package app.cetele.android.feature.shop.edit

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.dto.shops.UpdateShopRequest
import app.cetele.android.feature.shop.ShopFailure
import app.cetele.android.feature.shop.ShopForm
import app.cetele.android.feature.shop.ShopFormState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class EditShopViewModel
    @Inject
    constructor(
        private val shops: ShopRepository,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(ShopFormState())
        val state = mutableState.asStateFlow()
        private val mutableRole = MutableStateFlow<ShopRole?>(null)
        val role = mutableRole.asStateFlow()
        private var shopId: String? = null

        init {
            viewModelScope.launch {
                shops.observeActive().collect { shop ->
                    if (shopId != shop?.id || mutableRole.value != shop?.role) {
                        mutableState.value = ShopFormState(shop?.let(ShopForm::from) ?: ShopForm())
                    }
                    shopId = shop?.id
                    mutableRole.value = shop?.role
                }
            }
        }

        fun change(form: ShopForm) {
            if (!state.value.busy) mutableState.value = ShopFormState(form)
        }

        fun submit() {
            val id = shopId
            val current = state.value
            val allowed = role.value == ShopRole.OWNER && !current.busy && current.completedShopId == null
            if (id == null || !allowed) return
            val errors = current.form.errors()
            mutableState.value = current.copy(errors = errors, failure = null)
            if (errors.isNotEmpty()) return
            val request = current.form.request()
            mutableState.value = state.value.copy(busy = true)
            viewModelScope.launch {
                val result = shops.update(id, UpdateShopRequest(request.name, request.type, request.il, request.ilce))
                if (shopId == id && role.value == ShopRole.OWNER) {
                    mutableState.value =
                        when (result) {
                            is ApiResult.Success -> {
                                state.value.copy(busy = false, completedShopId = id)
                            }

                            is ApiResult.Failure -> {
                                val failure = ShopFailure.from(result)
                                state.value.copy(busy = false, failure = failure, errors = failure.fields)
                            }
                        }
                }
            }
        }
    }
