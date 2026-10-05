package app.cetele.android.core.domain

/**
 * An amount of Turkish lira in integer minor units (kuruş). Floating point is never used for money.
 * Arithmetic fails on overflow instead of wrapping.
 */
@JvmInline
value class Money(
    val minor: Long,
) : Comparable<Money> {
    val currency: String get() = CURRENCY_CODE

    operator fun plus(other: Money): Money = Money(Math.addExact(minor, other.minor))

    operator fun minus(other: Money): Money = Money(Math.subtractExact(minor, other.minor))

    operator fun unaryMinus(): Money = Money(Math.negateExact(minor))

    override fun compareTo(other: Money): Int = minor.compareTo(other.minor)

    val isPositive: Boolean get() = minor > 0

    companion object {
        /** ISO 4217 code; the product supports a single currency. */
        const val CURRENCY_CODE: String = "TRY"

        /** Number of kuruş in one lira. */
        const val MINOR_PER_MAJOR: Long = 100

        /** Upper bound of a single ledger entry: 100 000 000 TRY (server validation range). */
        const val MAX_ENTRY_MINOR: Long = 100_000_000L * MINOR_PER_MAJOR

        val ZERO: Money = Money(0)

        fun ofMinor(minor: Long): Money = Money(minor)

        fun sum(amounts: Iterable<Money>): Money = amounts.fold(ZERO) { acc, amount -> acc + amount }
    }
}

/** True when the amount is allowed on a single ledger entry (1 kuruş up to [Money.MAX_ENTRY_MINOR]). */
fun Money.isValidEntryAmount(): Boolean = minor in 1..Money.MAX_ENTRY_MINOR
