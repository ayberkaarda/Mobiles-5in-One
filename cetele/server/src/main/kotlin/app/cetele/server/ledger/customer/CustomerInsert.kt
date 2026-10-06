package app.cetele.server.ledger.customer

import jakarta.persistence.EntityManager
import java.util.UUID

interface CustomerInsert {
    fun insert(
        shopId: UUID,
        customer: Customer,
    ): Customer
}

class CustomerInsertImpl(
    private val entityManager: EntityManager,
) : CustomerInsert {
    override fun insert(
        shopId: UUID,
        customer: Customer,
    ): Customer {
        require(customer.shopId == shopId)
        entityManager.persist(customer)
        entityManager.flush()
        return customer
    }
}
