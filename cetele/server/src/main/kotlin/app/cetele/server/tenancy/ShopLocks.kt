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

    /** Platform-wide lock serialising the daily SMS cap check and reservation (not tied to one shop). */
    fun smsDailyCap() = lock("platform.sms-daily-cap", "global")

    private fun lock(
        namespace: String,
        shopId: UUID,
    ) = lock(namespace, shopId.toString())

    private fun lock(
        namespace: String,
        subject: String,
    ) {
        check(TransactionSynchronizationManager.isActualTransactionActive()) { "advisory locks need a transaction" }
        jdbc
            .sql("SELECT pg_advisory_xact_lock(:key)")
            .param("key", AuthLocks.key(namespace, subject))
            .query()
            .singleValue()
    }
}
