package app.cetele.archfixtures.account

import org.springframework.jdbc.core.simple.JdbcClient

/** Fixture: plain JDBC inside an allowlisted package. */
class AccountJdbcCaller(
    private val jdbc: JdbcClient,
) {
    fun count(): Int =
        jdbc
            .sql("SELECT 1")
            .query(Int::class.java)
            .single()
}
