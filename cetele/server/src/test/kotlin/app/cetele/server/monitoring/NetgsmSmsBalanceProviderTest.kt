package app.cetele.server.monitoring

import app.cetele.server.reminders.sms.NetgsmProperties
import app.cetele.server.support.LogCapture
import app.cetele.server.support.assertContains
import app.cetele.server.support.assertNoneOf
import org.junit.jupiter.api.Test
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.content
import org.springframework.test.web.client.match.MockRestRequestMatchers.method
import org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo
import org.springframework.test.web.client.response.MockRestResponseCreators.withException
import org.springframework.test.web.client.response.MockRestResponseCreators.withStatus
import org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess
import org.springframework.web.client.RestClient
import java.net.SocketTimeoutException
import java.util.UUID
import kotlin.test.assertEquals

/**
 * Fixtures shaped after the Netgsm balance documentation (`POST /balance`, `stip=1`); not verified
 * against the live API.
 */
@LogCapture
class NetgsmSmsBalanceProviderTest {
    private val password = "test-" + UUID.randomUUID()
    private val properties = NetgsmProperties(username = "test-balance-user", password = password, msgheader = "CETELE")
    private val builder = RestClient.builder().baseUrl(properties.endpoint())
    private val server = MockRestServiceServer.bindTo(builder).build()
    private val provider = NetgsmSmsBalanceProvider(builder.build(), properties)
    private val url = "https://api.netgsm.com.tr/balance"

    @Test
    fun `credit is the sum of the SMS packages and other balances are ignored`(output: CapturedOutput) {
        server
            .expect(requestTo(url))
            .andExpect(method(HttpMethod.POST))
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(content().json("""{"usercode":"test-balance-user","password":"$password","stip":1}"""))
            .andRespond(
                json(
                    """{"balance":[{"amount":"1200","balance_name":"Adet SMS"},{"amount":300,"balance_name":"Adet SMS"},""" +
                        """{"amount":"7,5","balance_name":"Kredi Bakiye"},{"amount":9,"balance_name":"Adet OTP SMS"}]}""",
                ),
            )
        assertEquals(SmsBalanceReading.Known(1500), provider.read())
        server.verify()
        output.assertContains("outcome=read credit=1500")
        output.assertNoneOf(password, properties.username)
    }

    @Test
    fun `an empty SMS package is zero credit, not unknown`() {
        server.expect(requestTo(url)).andRespond(json("""{"balance":[{"amount":"0","balance_name":"Adet SMS"}]}"""))
        assertEquals(SmsBalanceReading.Known(0), provider.read())
        server.verify()
    }

    @Test
    fun `provider error codes are unknown and descriptions cannot leak`(output: CapturedOutput) {
        listOf("30", "40", "70", "100").forEach { code ->
            server.expect(requestTo(url)).andRespond(json("""{"code":"$code","description":"$password"}"""))
            assertEquals(SmsBalanceReading.Unknown("provider_$code"), provider.read())
            server.reset()
        }
        server.expect(requestTo(url)).andRespond(json("""{"code":"$password"}"""))
        assertEquals(SmsBalanceReading.Unknown("invalid_response"), provider.read())
        server.verify()
        output.assertNoneOf(password)
    }

    @Test
    fun `any malformed amount fails the whole reading closed instead of a partial sum`() {
        val malformed =
            listOf(
                """{"amount":"-5","balance_name":"Adet SMS"}""",
                """{"amount":"12.5","balance_name":"Adet SMS"}""",
                """{"amount":12.5,"balance_name":"Adet SMS"}""",
                """{"amount":"","balance_name":"Adet SMS"}""",
                """{"amount":null,"balance_name":"Adet SMS"}""",
                """{"balance_name":"Adet SMS"}""",
                """{"amount":true,"balance_name":"Adet SMS"}""",
                """{"amount":"99999999999999999999","balance_name":"Adet SMS"}""",
            )
        malformed.forEach { pack ->
            server.expect(requestTo(url)).andRespond(json("""{"balance":[{"amount":"1000","balance_name":"Adet SMS"},$pack]}"""))
            assertEquals(SmsBalanceReading.Unknown("invalid_response"), provider.read(), pack)
            server.reset()
        }
        server.expect(requestTo(url)).andRespond(
            json("""{"balance":[{"amount":"${Long.MAX_VALUE}","balance_name":"Adet SMS"},{"amount":"1","balance_name":"Adet SMS"}]}"""),
        )
        assertEquals(SmsBalanceReading.Unknown("invalid_response"), provider.read())
        server.verify()
    }

    @Test
    fun `missing packages and unexpected shapes are unknown`() {
        val bodies =
            mapOf(
                """{"balance":[]}""" to "no_sms_package",
                """{"balance":[{"amount":"10","balance_name":"Kredi Bakiye"}]}""" to "no_sms_package",
                """{"balance":"1200"}""" to "invalid_response",
                """{"balance":["Adet SMS"]}""" to "invalid_response",
                """[]""" to "invalid_response",
                """{}""" to "invalid_response",
            )
        bodies.forEach { (body, reason) ->
            server.expect(requestTo(url)).andRespond(json(body))
            assertEquals(SmsBalanceReading.Unknown(reason), provider.read(), body)
            server.reset()
        }
        server.expect(requestTo(url)).andRespond(withSuccess("<html>maintenance</html>", MediaType.TEXT_HTML))
        assertEquals(SmsBalanceReading.Unknown("invalid_response"), provider.read())
        server.reset()
        server.expect(requestTo(url)).andRespond(withSuccess("""{"balance":[""", MediaType.APPLICATION_JSON))
        assertEquals(SmsBalanceReading.Unknown("invalid_response"), provider.read())
        server.verify()
    }

    @Test
    fun `HTTP errors and timeouts are unknown without retry`() {
        server.expect(requestTo(url)).andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE))
        assertEquals(SmsBalanceReading.Unknown("http_503"), provider.read())
        server.verify()
        server.reset()
        server.expect(requestTo(url)).andRespond(withStatus(HttpStatus.UNAUTHORIZED))
        assertEquals(SmsBalanceReading.Unknown("http_401"), provider.read())
        server.verify()
        server.reset()
        server.expect(requestTo(url)).andRespond(withException(SocketTimeoutException("private response")))
        assertEquals(SmsBalanceReading.Unknown("transport_error"), provider.read())
        server.verify()
    }

    private fun json(body: String) = withSuccess(body, MediaType.APPLICATION_JSON)
}
