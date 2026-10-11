package app.cetele.server.monitoring

import org.slf4j.LoggerFactory
import org.springframework.http.MediaType
import org.springframework.web.client.ResourceAccessException
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientException
import org.springframework.web.client.RestClientResponseException
import tools.jackson.databind.JsonNode

/**
 * Resend `POST /emails` with a Bearer key, shaped after the provider documentation and not verified
 * against the live API. Plain text only; no retry here (the monitor mails again on its next run). The
 * key, the recipients and the provider's error text are never logged.
 */
class ResendAlertMailer(
    private val client: RestClient,
    private val apiKey: String,
    private val from: String,
    private val recipients: List<String>,
) : AlertMailer {
    private val log = LoggerFactory.getLogger(ResendAlertMailer::class.java)

    init {
        require(apiKey.isNotBlank()) { "Resend API key is empty" }
        require(from.isNotBlank()) { "alert sender is empty" }
        require(recipients.isNotEmpty() && recipients.size <= MAX_RECIPIENTS) { "alert recipients must be 1 to $MAX_RECIPIENTS" }
    }

    override fun send(mail: AlertMail): AlertMailResult {
        val result =
            try {
                val response =
                    client
                        .post()
                        .uri("/emails")
                        .headers { it.setBearerAuth(apiKey) }
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(mapOf("from" to from, "to" to recipients, "subject" to mail.subject, "text" to mail.text))
                        .retrieve()
                        .body(JsonNode::class.java)
                val id = response?.get("id")?.takeIf { it.isString }?.asString()
                if (id.isNullOrBlank()) AlertMailResult.Failed("invalid_response") else AlertMailResult.Sent
            } catch (failure: RestClientResponseException) {
                AlertMailResult.Failed("http_${failure.statusCode.value()}")
            } catch (_: ResourceAccessException) {
                AlertMailResult.Failed("transport_error")
            } catch (_: RestClientException) {
                AlertMailResult.Failed("invalid_response")
            }
        when (result) {
            AlertMailResult.Sent -> log.info("Alert mail resend outcome=sent")
            is AlertMailResult.Failed -> log.warn("Alert mail resend outcome=failed reason={}", result.reason)
        }
        return result
    }

    companion object {
        const val MAX_RECIPIENTS = 50
    }
}
