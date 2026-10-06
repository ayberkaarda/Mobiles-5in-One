package app.cetele.server.tenancy

import app.cetele.server.auth.AuthLocks
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import org.springframework.transaction.support.TransactionSynchronizationManager
import java.util.UUID

@Component
class ShopLocks(
    private val jdbc: JdbcClient,
) {
    fun smsQuota(shopId: UUID) = lock("shop.sms-quota", shopId)

    fun mediaQuota(shopId: UUID) = lock("shop.media-quota", shopId)

    fun deletion(shopId: UUID) = lock("shop.deletion", shopId)

    private fun lock(
        namespace: String,
        shopId: UUID,
    ) {
        check(TransactionSynchronizationManager.isActualTransactionActive()) { "advisory locks need a transaction" }
        jdbc
            .sql("SELECT pg_advisory_xact_lock(:key)")
            .param("key", AuthLocks.key(namespace, shopId.toString()))
            .query()
            .singleValue()
    }
}
