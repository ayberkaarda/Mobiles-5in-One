package app.cetele.android.feature.customers.list

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.repository.CustomerListItem
import app.cetele.android.core.data.repository.CustomerRepository
import app.cetele.android.core.data.repository.SearchNormalizer
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.domain.model.Shop
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

data class CustomerListState(
    val query: String = "",
    val shop: Shop? = null,
    val customers: List<CustomerListItem> = emptyList(),
    val loading: Boolean = true,
)

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class CustomerListViewModel
    @Inject
    constructor(
        shops: ShopRepository,
        customers: CustomerRepository,
    ) : ViewModel() {
        private val query = MutableStateFlow("")
        val state =
            combine(shops.observeActive(), query) { shop, text -> shop to text }
                .flatMapLatest { (shop, text) ->
                    if (shop == null) {
                        flowOf(CustomerListState(query = text, loading = false))
                    } else {
                        customers.observeList(shop.id, SearchNormalizer.normalize(text)).map { rows ->
                            CustomerListState(text, shop, rows, loading = false)
                        }
                    }
                }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), CustomerListState())

        fun search(text: String) {
            query.value = text
        }
    }
