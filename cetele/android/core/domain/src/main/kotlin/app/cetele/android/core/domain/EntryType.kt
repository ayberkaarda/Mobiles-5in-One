package app.cetele.android.core.domain

/** Kind of an immutable ledger entry. Corrections are reversing entries, never edits. */
enum class EntryType {
    DEBT,
    PAYMENT,
}
