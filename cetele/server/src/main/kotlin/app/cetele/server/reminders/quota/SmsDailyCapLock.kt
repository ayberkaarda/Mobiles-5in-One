package app.cetele.server.reminders.quota

import app.cetele.server.auth.AuthLocks
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import org.springframework.transaction.support.TransactionSynchronizationManager

/** Transaction-scoped advisory lock serialising the platform-wide daily SMS cap check and reservation. */
@Component
class SmsDailyCapLock(
    private val jdbc: JdbcClient,
) {
    fun acquire() {
        check(TransactionSynchronizationManager.isActualTransactionActive()) { "advisory locks need a transaction" }
        jdbc
            .sql("SELECT pg_advisory_xact_lock(:key)")
            .param("key", AuthLocks.key("sms.daily-cap", "global"))
            .query()
            .singleValue()
    }
}
