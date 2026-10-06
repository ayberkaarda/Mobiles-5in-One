package app.cetele.server.config

import app.cetele.server.auth.AuthLocks
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.support.TransactionTemplate

@Component
class JobLocks(
    private val jdbc: JdbcClient,
    transactionManager: PlatformTransactionManager,
) {
    private val tx =
        TransactionTemplate(transactionManager).apply {
            propagationBehavior = TransactionDefinition.PROPAGATION_REQUIRES_NEW
        }

    fun runExclusive(
        name: String,
        block: () -> Unit,
    ): Boolean =
        tx.execute {
            val acquired =
                jdbc
                    .sql("SELECT pg_try_advisory_xact_lock(:key)")
                    .param("key", AuthLocks.key("job", name))
                    .query(Boolean::class.java)
                    .single()
            if (acquired) block()
            acquired
        }
}
