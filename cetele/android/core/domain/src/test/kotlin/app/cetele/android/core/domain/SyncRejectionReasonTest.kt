package app.cetele.android.core.domain

import app.cetele.android.core.domain.sync.SyncRejectionReason
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class SyncRejectionReasonTest {
    @Test
    fun `every documented operation rejection maps without losing its code`() {
        val codes =
            setOf(
                "forbidden",
                "not_found",
                "conflict",
                "validation.failed",
                "customer.deleted",
                "ledger.already_reversed",
                "ledger.reversal_mismatch",
                "plan.customer_limit",
            )
        assertEquals(codes, SyncRejectionReason.entries.map { it.code }.toSet())
        SyncRejectionReason.entries.forEach { assertEquals(it, SyncRejectionReason.fromCode(it.code)) }
        assertNull(SyncRejectionReason.fromCode("unrecognized.code"))
    }
}
