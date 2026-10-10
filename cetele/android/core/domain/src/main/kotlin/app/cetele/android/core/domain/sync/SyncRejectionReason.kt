package app.cetele.android.core.domain.sync

enum class SyncRejectionReason(
    val code: String,
) {
    FORBIDDEN("forbidden"),
    NOT_FOUND("not_found"),
    CONFLICT("conflict"),
    VALIDATION_FAILED("validation.failed"),
    CUSTOMER_DELETED("customer.deleted"),
    ALREADY_REVERSED("ledger.already_reversed"),
    REVERSAL_MISMATCH("ledger.reversal_mismatch"),
    CUSTOMER_LIMIT("plan.customer_limit"),
    ;

    companion object {
        fun fromCode(code: String): SyncRejectionReason? = entries.firstOrNull { it.code == code }
    }
}
