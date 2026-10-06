package app.cetele.archfixtures.jdbc

import org.springframework.jdbc.core.simple.JdbcClient

/** Fixture: plain JDBC outside the allowlisted classes and packages. */
class RawJdbcCaller(
    private val jdbc: JdbcClient,
) {
    fun count(): Int =
        jdbc
            .sql("SELECT 1")
            .query(Int::class.java)
            .single()
}
