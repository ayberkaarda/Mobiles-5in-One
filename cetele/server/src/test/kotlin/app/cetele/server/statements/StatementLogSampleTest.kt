package app.cetele.server.statements

import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.LogCapture
import app.cetele.server.support.assertContains
import app.cetele.server.support.assertNoneOf
import org.junit.jupiter.api.Test
import org.springframework.boot.test.system.CapturedOutput
import kotlin.test.assertEquals

@IntegrationTest
@LogCapture
class StatementLogSampleTest : StatementTestSupport() {
    @Test
    fun `opening logs the route pattern and ids only`(output: CapturedOutput) {
        val w = world()
        val customer = "Private Customer Name"
        val shop = "Private Shop Name"
        jdbc.update("UPDATE shops SET name = ? WHERE id = ?", shop, w.shopId)
        val c = ledger().customer(w.shopId, name = customer)
        val link = links.issue(w.shopId, c, w.owner.id, now = clock.instant())
        assertEquals(200, open(link.token).status)
        output.assertContains("route=/s/{token}")
        output.assertContains("outcome=opened")
        output.assertNoneOf(link.token, link.url, customer, shop)
    }
}
