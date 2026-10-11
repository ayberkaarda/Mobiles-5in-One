package app.cetele.server.monitoring

import app.cetele.server.support.LogCapture
import app.cetele.server.support.assertContains
import app.cetele.server.support.assertNoneOf
import org.junit.jupiter.api.Test
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.test.json.JsonCompareMode
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
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse

/** Fixtures shaped after the Resend `POST /emails` documentation; not verified against the live API. */
@LogCapture
class ResendAlertMailerTest {
    private val key = "re_test_" + UUID.randomUUID().toString().replace("-", "")
    private val properties = ResendProperties(apiKey = key)
    private val builder = RestClient.builder().baseUrl(properties.endpoint())
    private val server = MockRestServiceServer.bindTo(builder).build()
    private val recipients = listOf("ops-one@example.test", "ops-two@example.test")
    private val mailer = ResendAlertMailer(builder.build(), key, "alerts@example.test", recipients)
    private val mail = AlertMail("Cetele: SMS kredisi alt sınırın altında", "Kural: below_minimum\ncredit=12 threshold=500")
    private val url = "https://api.resend.com/emails"

    @Test
    fun `send posts a plain text mail with the Bearer key and logs no key or recipient`(output: CapturedOutput) {
        server
            .expect(requestTo(url))
            .andExpect(method(HttpMethod.POST))
            .andExpect(header(HttpHeaders.AUTHORIZATION, "Bearer $key"))
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(
                content().json(
                    """{"from":"alerts@example.test","to":["ops-one@example.test","ops-two@example.test"],""" +
                        """"subject":"${mail.subject}","text":"Kural: below_minimum\ncredit=12 threshold=500"}""",
                    JsonCompareMode.STRICT,
                ),
            ).andRespond(withSuccess("""{"id":"49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"}""", MediaType.APPLICATION_JSON))
        assertEquals(AlertMailResult.Sent, mailer.send(mail))
        server.verify()
        output.assertContains("Alert mail resend outcome=sent")
        output.assertNoneOf(key, "ops-one@example.test", "ops-two@example.test")
    }

    @Test
    fun `provider errors have bounded reasons and never echo the provider message`(output: CapturedOutput) {
        server.expect(requestTo(url)).andRespond(
            withStatus(HttpStatus.UNPROCESSABLE_CONTENT)
                .contentType(MediaType.APPLICATION_JSON)
                .body("""{"statusCode":422,"name":"validation_error","message":"$key"}"""),
        )
        assertEquals(AlertMailResult.Failed("http_422"), mailer.send(mail))
        server.reset()
        server.expect(requestTo(url)).andRespond(withStatus(HttpStatus.TOO_MANY_REQUESTS))
        assertEquals(AlertMailResult.Failed("http_429"), mailer.send(mail))
        server.reset()
        server.expect(requestTo(url)).andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR))
        assertEquals(AlertMailResult.Failed("http_500"), mailer.send(mail))
        server.reset()
        server.expect(requestTo(url)).andRespond(withException(SocketTimeoutException(key)))
        assertEquals(AlertMailResult.Failed("transport_error"), mailer.send(mail))
        server.reset()
        server.expect(requestTo(url)).andRespond(withSuccess("""{"id":""}""", MediaType.APPLICATION_JSON))
        assertEquals(AlertMailResult.Failed("invalid_response"), mailer.send(mail))
        server.reset()
        server.expect(requestTo(url)).andRespond(withSuccess("not json", MediaType.APPLICATION_JSON))
        assertEquals(AlertMailResult.Failed("invalid_response"), mailer.send(mail))
        server.verify()
        output.assertContains("outcome=failed reason=http_422")
        output.assertNoneOf(key)
    }

    @Test
    fun `the key never reaches a toString and empty settings are refused`() {
        assertFalse(properties.toString().contains(key))
        assertFalse(AlertProperties(mailer = "resend", to = recipients.joinToString(","), resend = properties).toString().contains(key))
        assertFailsWith<IllegalArgumentException> { ResendAlertMailer(builder.build(), " ", "alerts@example.test", recipients) }
        assertFailsWith<IllegalArgumentException> { ResendAlertMailer(builder.build(), key, "", recipients) }
        assertFailsWith<IllegalArgumentException> { ResendAlertMailer(builder.build(), key, "alerts@example.test", emptyList()) }
        assertEquals(listOf("a@example.test", "b@example.test"), AlertProperties(to = " a@example.test, ,b@example.test ").recipients())
        assertEquals("https://mail.example.test", ResendProperties(baseUrl = "https://mail.example.test/").endpoint())
    }
}
