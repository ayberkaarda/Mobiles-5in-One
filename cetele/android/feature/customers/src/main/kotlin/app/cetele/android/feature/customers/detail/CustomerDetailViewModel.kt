package app.cetele.android.feature.customers.detail

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.repository.CustomerRepository
import app.cetele.android.core.data.repository.LedgerRepository
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.data.write.WriteResult
import app.cetele.android.core.domain.ledger.StatementRow
import app.cetele.android.core.domain.ledger.StatementRows
import app.cetele.android.core.domain.model.Customer
import app.cetele.android.core.domain.model.Money
import app.cetele.android.core.domain.model.ShopRole
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class CustomerDetailState(
    val customer: Customer? = null,
    val role: ShopRole? = null,
    val balance: Money = Money.ZERO,
    val rows: List<StatementRow> = emptyList(),
    val loading: Boolean = true,
    val deleting: Boolean = false,
    val deleted: Boolean = false,
    val problemCode: String? = null,
)

private data class DeleteState(
    val busy: Boolean = false,
    val done: Boolean = false,
    val code: String? = null,
)

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class CustomerDetailViewModel
    @Inject
    constructor(
        savedStateHandle: SavedStateHandle,
        private val customers: CustomerRepository,
        private val shops: ShopRepository,
        ledger: LedgerRepository,
    ) : ViewModel() {
        private val customerId = checkNotNull(savedStateHandle.get<String>("customerId"))
        private val deletion = MutableStateFlow(DeleteState())
        private val customerState =
            shops.observeActive().flatMapLatest { shop ->
                if (shop == null) {
                    flowOf(CustomerDetailState(loading = false, problemCode = "not_found"))
                } else {
                    combine(
                        customers.observe(shop.id, customerId),
                        customers.observeBalance(shop.id, customerId),
                        ledger.observeEntries(shop.id, customerId),
                    ) { customer, balance, entries ->
                        CustomerDetailState(
                            customer = customer?.takeIf { it.deletedAt == null },
                            role = shop.role,
                            balance = balance,
                            rows = StatementRows.build(entries),
                            loading = false,
                            problemCode =
                                if (customer == null ||
                                    customer.deletedAt != null
                                ) {
                                    "customer.deleted"
                                } else {
                                    null
                                },
                        )
                    }
                }
            }
        val state =
            combine(customerState, deletion) { customer, progress ->
                customer.copy(
                    deleting = progress.busy,
                    deleted = progress.done,
                    problemCode =
                        progress.code ?: customer.problemCode,
                )
            }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), CustomerDetailState())

        fun delete() {
            val current = state.value
            val customer = current.customer ?: return
            if (current.role != ShopRole.OWNER || deletion.value.busy || deletion.value.done) return
            deletion.value = DeleteState(busy = true)
            viewModelScope.launch {
                val active = shops.observeActive().first()
                if (active == null || active.id != customer.shopId || active.role != ShopRole.OWNER) {
                    deletion.value = DeleteState(code = "forbidden")
                } else {
                    when (val result = customers.delete(customer.shopId, customer.id)) {
                        is WriteResult.Ok -> deletion.value = DeleteState(done = true)
                        is WriteResult.Invalid -> deletion.value = DeleteState(code = result.errors.firstOrNull()?.code)
                    }
                }
            }
        }
    }
