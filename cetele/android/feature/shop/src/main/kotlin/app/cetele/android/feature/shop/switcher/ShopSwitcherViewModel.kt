package app.cetele.android.feature.shop.switcher

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.network.ApiResult
import app.cetele.android.feature.shop.ShopFailure
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ShopSwitcherState(
    val shops: List<Shop> = emptyList(),
    val activeId: String? = null,
    val selectedId: String? = null,
    val busy: Boolean = false,
    val failure: ShopFailure? = null,
)

@HiltViewModel
class ShopSwitcherViewModel
    @Inject
    constructor(
        private val shops: ShopRepository,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(ShopSwitcherState())
        val state = mutableState.asStateFlow()

        init {
            viewModelScope.launch {
                combine(shops.observeShops(), shops.observeActive()) { list, active ->
                    list to active
                }.collect { (list, active) ->
                    mutableState.value = state.value.copy(shops = list, activeId = active?.id)
                }
            }
            refresh()
        }

        fun refresh() {
            if (state.value.busy) return
            mutableState.value = state.value.copy(busy = true, failure = null)
            viewModelScope.launch {
                val result = shops.refresh()
                mutableState.value =
                    state.value.copy(
                        busy = false,
                        failure = (result as? ApiResult.Failure)?.let { ShopFailure.from(it) },
                    )
            }
        }

        fun select(id: String) {
            if (state.value.busy || state.value.shops.none { it.id == id }) return
            mutableState.value = state.value.copy(busy = true)
            viewModelScope.launch {
                shops.setActive(id)
                mutableState.value = state.value.copy(busy = false, selectedId = id)
            }
        }
    }
