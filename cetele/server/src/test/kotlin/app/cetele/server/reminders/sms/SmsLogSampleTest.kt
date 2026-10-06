package app.cetele.server.reminders.sms

import app.cetele.server.config.logging.Masking
import app.cetele.server.support.LogCapture
import app.cetele.server.support.TestUsers
import app.cetele.server.support.assertContains
import app.cetele.server.support.assertNoneOf
import org.junit.jupiter.api.Test
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo
import org.springframework.test.web.client.response.MockRestResponseCreators.withStatus
import org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess
import org.springframework.web.client.RestClient
import java.util.UUID
import kotlin.test.assertEquals

@LogCapture
class SmsLogSampleTest {
    @Test
    fun `provider failures log only outcomes codes and masked phones`(output: CapturedOutput) {
        val password = "test-" + UUID.randomUUID()
        val properties = NetgsmProperties(username = "private-user", password = password, msgheader = "CETELE")
        val builder = RestClient.builder().baseUrl(properties.endpoint())
        val server = MockRestServiceServer.bindTo(builder).build()
        val gateway = NetgsmSmsGateway(builder.build(), properties)
        val phone = TestUsers.phone()
        val name = "Private Customer"
        val amount = "₺1.250,00"
        val url = "https://example.test/s/" + UUID.randomUUID()
        val message = SmsMessage(phone, "$name $amount $url", SmsKind.REMINDER)
        server.expect(requestTo("https://api.netgsm.com.tr/sms/rest/v2/send")).andRespond(
            withSuccess("""{"code":"30","description":"$password $name $url"}""", MediaType.APPLICATION_JSON),
        )
        server.expect(requestTo("https://api.netgsm.com.tr/sms/rest/v2/send")).andRespond(
            withStatus(HttpStatus.INTERNAL_SERVER_ERROR).body("$password $name $url"),
        )
        assertEquals(SmsSendResult.Rejected("30"), gateway.send(message))
        assertEquals(SmsSendResult.Failed("http_500"), gateway.send(message))
        server.verify()
        output.assertContains("outcome=rejected")
        output.assertContains("outcome=failed")
        output.assertContains(Masking.phone(phone))
        output.assertNoneOf(password, properties.username, phone, name, amount, url, message.text)
    }
}
