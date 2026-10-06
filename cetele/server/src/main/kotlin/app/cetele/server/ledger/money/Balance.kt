package app.cetele.server.ledger.money

import java.util.UUID

data class BalanceLine(
    val type: String,
    val amountMinor: Long,
    val reverses: UUID? = null,
    val reversedBy: UUID? = null,
)

object Balance {
    fun of(entries: Iterable<BalanceLine>): Long =
        entries
            .filter { it.reverses == null && it.reversedBy == null }
            .fold(0L) { total, entry ->
                val signed =
                    when (entry.type) {
                        "DEBT" -> entry.amountMinor
                        "PAYMENT" -> Math.negateExact(entry.amountMinor)
                        else -> error("unknown ledger entry type")
                    }
                Math.addExact(total, signed)
            }
}
