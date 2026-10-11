package app.cetele.server.billing

import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.LogCapture
import app.cetele.server.support.assertContains
import app.cetele.server.support.assertNoneOf
import app.cetele.server.tenancy.TenancyFixtures.Companion.expectProblem
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.system.CapturedOutput
import java.util.Base64
import kotlin.test.assertTrue

@IntegrationTest
@LogCapture
class BillingLogSampleTest : BillingTestSupport() {
    @Autowired lateinit var sweeper: BillingSweeper

    @Test
    fun `link, rtdn and sweep log outcomes without the token or its hash`(output: CapturedOutput) {
        val world = world()
        val other = world()
        val token = token("active", world.shopId)
        val pushToken = signer.sign(expectations.audience)
        linkOk(world.shopId, token, world.owner)
        link(other.shopId, token, other.owner).expectProblem(409, "billing.token_in_use")
        val unavailable = token("unavailable", other.shopId)
        link(other.shopId, unavailable, other.owner).expectProblem(503, "billing.unavailable")
        val body = envelope(subscriptionNotification(token, 12))
        push(body, "Bearer $pushToken").andExpect { status { isOk() } }
        push(body, "Bearer x$pushToken").expectProblem(401, "webhook.unauthenticated")
        processor.processDue(clock.instant())
        sweeper.sweep(clock.instant())

        output.assertContains("outcome=linked")
        output.assertContains("outcome=refused code=billing.token_in_use")
        output.assertContains("outcome=unavailable")
        output.assertContains("plan changed shop=${world.shopId} from=FREE to=PRO reason=link")
        output.assertContains("plan changed shop=${world.shopId} from=PRO to=FREE reason=rtdn")
        output.assertContains("Rtdn webhook outcome=stored")
        output.assertContains("Rtdn processing outcome=revoked")
        output.assertContains("Billing sweep reverified=")
        val stored =
            jdbc.queryForObject(
                "SELECT purchase_token_enc FROM subscriptions WHERE purchase_token_hash = ?",
                ByteArray::class.java,
                PurchaseTokens.hash(token),
            )
        output.assertNoneOf(
            token,
            unavailable,
            PurchaseTokens.hash(token),
            PurchaseTokens.hash(unavailable),
            PurchaseTokens.obfuscatedAccountId(world.shopId),
            pushToken,
            pushToken.substringAfterLast('.'),
            Base64.getEncoder().encodeToString(subscriptionNotification(token, 12).toByteArray()),
            world.owner.bearer.removePrefix("Bearer "),
            world.owner.phone,
            stored?.let { Base64.getEncoder().encodeToString(it) } ?: "",
        )
        assertTrue(output.all.isNotEmpty())
    }
}
