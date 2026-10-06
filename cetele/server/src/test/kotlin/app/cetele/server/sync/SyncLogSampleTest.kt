package app.cetele.server.sync

import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.LogCapture
import app.cetele.server.support.TestUsers
import app.cetele.server.support.assertContains
import app.cetele.server.support.assertNoneOf
import org.junit.jupiter.api.Test
import org.springframework.boot.test.system.CapturedOutput

@IntegrationTest
@LogCapture
class SyncLogSampleTest : SyncTestSupport() {
    @Test
    fun `push and pull log ids and counts without customer or entry contents`(output: CapturedOutput) {
        val world = world()
        val phone = TestUsers.phone()
        val c =
            customer(1, name = "SensitiveCustomerName").let {
                it.copy(customer = it.customer!!.copy(phone = phone, note = "SensitiveCustomerNote"))
            }
        val e =
            entry(2, c.customer!!.id, 987_654_321L).let {
                it.copy(entry = it.entry!!.copy(note = "SensitiveEntryNote"))
            }
        assertCodes(push(world, listOf(c, e)), null, null)
        pull(world)
        output.assertContains("Sync push")
        output.assertContains("Sync pull")
        output.assertNoneOf(
            "SensitiveCustomerName",
            "SensitiveCustomerNote",
            "SensitiveEntryNote",
            phone,
            "987654321",
            world.owner.bearer,
            "\"payload\"",
            "\"amountMinor\"",
        )
    }
}
