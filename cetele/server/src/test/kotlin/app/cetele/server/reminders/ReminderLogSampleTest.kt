package app.cetele.server.reminders

import app.cetele.server.config.logging.Masking
import app.cetele.server.ledger.money.MoneyFormat
import app.cetele.server.reminders.sms.FakeSmsGateway
import app.cetele.server.reminders.sms.SmsGateway
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.LogCapture
import app.cetele.server.support.TestAuth
import app.cetele.server.support.TestUsers
import app.cetele.server.support.assertContains
import app.cetele.server.support.assertNoneOf
import app.cetele.server.tenancy.TenancyFixtures.Companion.expectProblem
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import kotlin.test.assertNotNull

@IntegrationTest
@LogCapture
class ReminderLogSampleTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val auth: TestAuth,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val gateway: SmsGateway,
) {
    @Test
    fun `success and failure log ids outcomes and masked phone only`(output: CapturedOutput) {
        val f = ReminderFixtures(mvc, auth, jdbc)
        val phone = TestUsers.phone()
        val customer = f.ledger.customer(f.shopId, name = "SensitiveReminderName", phone = phone, smsConsent = true)
        f.ledger.entry(f.shopId, customer, amountMinor = 987_654_321L, note = "SensitiveReminderNote")
        f.send(customer).andExpect { status { isCreated() } }
        val fake = gateway as FakeSmsGateway
        val text = assertNotNull(fake.lastMessageTo(phone)).text
        fake.failNextSend("SensitiveFailureReason")
        f.send(customer).expectProblem(502, "sms.provider_failed")
        output.assertContains("Reminder shop=")
        output.assertContains("outcome=sent")
        output.assertContains("outcome=failed")
        output.assertContains(Masking.phone(phone))
        output.assertContains(f.shopId.toString())
        output.assertNoneOf(
            phone,
            "SensitiveReminderName",
            "SensitiveReminderNote",
            "SensitiveFailureReason",
            "987654321",
            MoneyFormat.format(987_654_321L),
            text,
            text.substringAfterLast("/s/"),
            f.owner.bearer,
        )
    }
}
