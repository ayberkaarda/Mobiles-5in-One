package app.cetele.server.reminders.sms

import app.cetele.server.support.LogCapture
import app.cetele.server.support.TestUsers
import app.cetele.server.support.assertContains
import app.cetele.server.support.assertNoneOf
import org.junit.jupiter.api.Test
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.content
import org.springframework.test.web.client.match.MockRestRequestMatchers.header
import org.springframework.test.web.client.match.MockRestRequestMatchers.method
import org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo
import org.springframework.test.web.client.response.MockRestResponseCreators.withException
import org.springframework.test.web.client.response.MockRestResponseCreators.withStatus
import org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess
import org.springframework.web.client.RestClient
import java.net.SocketTimeoutException
import java.util.Base64
import java.util.UUID
import kotlin.test.assertEquals

/** Shape per provider documentation, not verified against the live API. */
@LogCapture
class NetgsmSmsGatewayTest {
    private val password = "test-" + UUID.randomUUID()
    private val properties = NetgsmProperties(username = "test-user", password = password, msgheader = "CETELE")
    private val builder = RestClient.builder().baseUrl(properties.endpoint())
    private val server = MockRestServiceServer.bindTo(builder).build()
    private val gateway = NetgsmSmsGateway(builder.build(), properties)
    private val phone = TestUsers.phone()
    private val message = SmsMessage(phone, "Sayın Ayşe, hesap dökümü: https://example.test/s/private", SmsKind.REMINDER)

    @Test
    fun `send posts one Turkish message with Basic authentication and sender name`(output: CapturedOutput) {
        val authorization = "Basic " + Base64.getEncoder().encodeToString("${properties.username}:$password".toByteArray())
        server
            .expect(requestTo("https://api.netgsm.com.tr/sms/rest/v2/send"))
            .andExpect(method(HttpMethod.POST))
            .andExpect(header(HttpHeaders.AUTHORIZATION, authorization))
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(
                content().json(
                    """{"msgheader":"CETELE","messages":[{"msg":"${message.text}","no":"${phone.removePrefix(
                        "+90",
                    )}"}],"encoding":"TR","iysfilter":"0"}""",
                ),
            ).andRespond(withSuccess("""{"code":"00","jobid":"120210000","description":"success"}""", MediaType.APPLICATION_JSON))
        assertEquals(SmsSendResult.Accepted("120210000"), gateway.send(message))
        server.verify()
        output.assertContains("outcome=accepted")
        output.assertNoneOf(password, properties.username, authorization, phone, message.text, "Ayşe", "https://example.test/s/private")
    }

    @Test
    fun `provider rejection codes are preserved and descriptions cannot leak`() {
        val codes = listOf("20", "30", "40", "50", "51", "70", "80", "85")
        for (code in codes) {
            server.expect(requestTo("https://api.netgsm.com.tr/sms/rest/v2/send")).andRespond(
                withSuccess("""{"code":"$code","description":"$password"}""", MediaType.APPLICATION_JSON),
            )
        }
        codes.forEach { assertEquals(SmsSendResult.Rejected(it), gateway.send(message)) }
        server.verify()
    }

    @Test
    fun `HTTP 500 fails without retry`() {
        server.expect(requestTo("https://api.netgsm.com.tr/sms/rest/v2/send")).andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR))
        assertEquals(SmsSendResult.Failed("http_500"), gateway.send(message))
        server.verify()
    }

    @Test
    fun `timeout fails without retry`() {
        server.expect(requestTo("https://api.netgsm.com.tr/sms/rest/v2/send")).andRespond(
            withException(SocketTimeoutException("private response")),
        )
        assertEquals(SmsSendResult.Failed("transport_error"), gateway.send(message))
        server.verify()
    }

    @Test
    fun `HTTP rejection and malformed provider replies have bounded reasons`() {
        server.expect(requestTo("https://api.netgsm.com.tr/sms/rest/v2/send")).andRespond(withStatus(HttpStatus.UNAUTHORIZED))
        assertEquals(SmsSendResult.Rejected("http_401"), gateway.send(message))
        server.reset()
        server.expect(requestTo("https://api.netgsm.com.tr/sms/rest/v2/send")).andRespond(
            withSuccess("""{"code":"00"}""", MediaType.APPLICATION_JSON),
        )
        assertEquals(SmsSendResult.Failed("invalid_response"), gateway.send(message))
        server.reset()
        server.expect(requestTo("https://api.netgsm.com.tr/sms/rest/v2/send")).andRespond(
            withSuccess("""{"code":"$password"}""", MediaType.APPLICATION_JSON),
        )
        assertEquals(SmsSendResult.Failed("invalid_response"), gateway.send(message))
        server.verify()
    }

    @Test
    fun `OTP uses the shared send adapter`() {
        server.expect(requestTo("https://api.netgsm.com.tr/sms/rest/v2/send")).andRespond(
            withSuccess("""{"code":"00","jobid":"120210001"}""", MediaType.APPLICATION_JSON),
        )
        assertEquals(SmsSendResult.Accepted("120210001"), gateway.send(message.copy(kind = SmsKind.OTP)))
        server.verify()
    }

    @Test
    fun `balance queries SMS packages without including unrelated balances`() {
        server
            .expect(requestTo("https://api.netgsm.com.tr/balance"))
            .andExpect(method(HttpMethod.POST))
            .andExpect(content().json("""{"usercode":"test-user","password":"$password","stip":1}"""))
            .andRespond(
                withSuccess(
                    """{"balance":[{"amount":20,"balance_name":"Adet SMS"},{"amount":"15","balance_name":"Adet SMS"},{"amount":99,"balance_name":"Kredi Bakiye"}]}""",
                    MediaType.APPLICATION_JSON,
                ),
            )
        assertEquals(SmsBalance(35, null), gateway.balance())
        server.verify()
    }

    @Test
    fun `balance failure stays unknown instead of reporting zero credit`() {
        server.expect(requestTo("https://api.netgsm.com.tr/balance")).andRespond(
            withSuccess("""{"code":"30"}""", MediaType.APPLICATION_JSON),
        )
        assertEquals(SmsBalance(null, null), gateway.balance())
        server.reset()
        server.expect(requestTo("https://api.netgsm.com.tr/balance")).andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR))
        assertEquals(SmsBalance(null, null), gateway.balance())
        server.verify()
    }
}
