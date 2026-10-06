package app.cetele.android.core.data.repository

import app.cetele.android.core.data.database.DatabaseStore
import app.cetele.android.core.data.write.CustomerDraft
import app.cetele.android.core.data.write.LocalWriteService
import app.cetele.android.core.data.write.WriteResult
import app.cetele.android.core.domain.model.Customer
import app.cetele.android.core.domain.model.Money
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import javax.inject.Inject

data class CustomerListItem(
    val customer: Customer,
    val balance: Money,
)

interface CustomerRepository {
    fun observeList(
        shopId: String,
        query: String = "",
    ): Flow<List<CustomerListItem>>

    fun observe(
        shopId: String,
        id: String,
    ): Flow<Customer?>

    fun observeBalance(
        shopId: String,
        id: String,
    ): Flow<Money>

    suspend fun save(
        shopId: String,
        draft: CustomerDraft,
    ): WriteResult

    suspend fun delete(
        shopId: String,
        id: String,
    ): WriteResult
}

class RoomCustomerRepository
    @Inject
    constructor(
        private val databases: DatabaseStore,
        private val writes: LocalWriteService,
    ) : CustomerRepository {
        override fun observeList(
            shopId: String,
            query: String,
        ): Flow<List<CustomerListItem>> {
            val dao = databases.get().customerDao()
            return combine(
                dao.observeLive(shopId, SearchNormalizer.query(query)),
                dao.observeBalances(shopId),
            ) { rows, balances ->
                val amounts = balances.associate { it.customerId to it.balanceMinor }
                rows.map { CustomerListItem(it.asModel(), Money(amounts[it.id] ?: 0)) }
            }
        }

        override fun observe(
            shopId: String,
            id: String,
        ): Flow<Customer?> =
            databases.get().customerDao().observe(shopId, id).map {
                it?.asModel()
            }

        override fun observeBalance(
            shopId: String,
            id: String,
        ): Flow<Money> =
            databases.get().customerDao().observeBalances(shopId).map { rows ->
                Money(rows.firstOrNull { it.customerId == id }?.balanceMinor ?: 0)
            }

        override suspend fun save(
            shopId: String,
            draft: CustomerDraft,
        ): WriteResult = writes.upsertCustomer(shopId, draft)

        override suspend fun delete(
            shopId: String,
            id: String,
        ): WriteResult = writes.deleteCustomer(shopId, id)
    }
