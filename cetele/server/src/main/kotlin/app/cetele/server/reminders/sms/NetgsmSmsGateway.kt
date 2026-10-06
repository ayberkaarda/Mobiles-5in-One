package app.cetele.server.reminders.sms

import app.cetele.server.config.logging.Masking
import org.slf4j.LoggerFactory
import org.springframework.http.MediaType
import org.springframework.web.client.ResourceAccessException
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientException
import org.springframework.web.client.RestClientResponseException
import tools.jackson.databind.JsonNode

class NetgsmSmsGateway(
    private val client: RestClient,
    private val properties: NetgsmProperties,
) : SmsGateway {
    private val log = LoggerFactory.getLogger(NetgsmSmsGateway::class.java)

    override fun send(message: SmsMessage): SmsSendResult {
        val result =
            try {
                val response =
                    client
                        .post()
                        .uri("/sms/rest/v2/send")
                        .headers { it.setBasicAuth(properties.username, properties.password) }
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(
                            mapOf(
                                "msgheader" to properties.msgheader,
                                "messages" to listOf(mapOf("msg" to message.text, "no" to message.phoneE164.removePrefix("+90"))),
                                "encoding" to "TR",
                                "iysfilter" to "0",
                            ),
                        ).retrieve()
                        .body(JsonNode::class.java)
                val code = response?.get("code")?.asString().orEmpty()
                when {
                    code == "00" -> {
                        val id = response?.get("jobid")?.asString()?.takeIf { it.isNotBlank() }
                        if (id == null) SmsSendResult.Failed("invalid_response") else SmsSendResult.Accepted(id)
                    }

                    PROVIDER_CODE.matches(code) -> {
                        SmsSendResult.Rejected(code)
                    }

                    else -> {
                        SmsSendResult.Failed("invalid_response")
                    }
                }
            } catch (failure: RestClientResponseException) {
                if (failure.statusCode.is4xxClientError) {
                    SmsSendResult.Rejected("http_${failure.statusCode.value()}")
                } else {
                    SmsSendResult.Failed("http_${failure.statusCode.value()}")
                }
            } catch (_: ResourceAccessException) {
                SmsSendResult.Failed("transport_error")
            } catch (_: RestClientException) {
                SmsSendResult.Failed("invalid_response")
            }
        val outcome =
            when (result) {
                is SmsSendResult.Accepted -> "accepted"
                is SmsSendResult.Rejected -> "rejected"
                is SmsSendResult.Failed -> "failed"
            }
        val code =
            when (result) {
                is SmsSendResult.Accepted -> "00"
                is SmsSendResult.Rejected -> result.reason
                is SmsSendResult.Failed -> result.reason
            }
        log.info("SMS netgsm outcome={} providerCode={} to={}", outcome, code, Masking.phone(message.phoneE164))
        return result
    }

    override fun balance(): SmsBalance =
        try {
            val response =
                client
                    .post()
                    .uri("/balance")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(mapOf("usercode" to properties.username, "password" to properties.password, "stip" to 1))
                    .retrieve()
                    .body(JsonNode::class.java)
            val packages = response?.get("balance")
            var credit = 0L
            var found = false
            if (packages != null && packages.isArray) {
                for (index in 0 until packages.size()) {
                    val pack = packages.get(index)
                    if (pack.get("balance_name")?.asString() == "Adet SMS") {
                        val amount = pack.get("amount")?.asString()?.toLongOrNull()
                        if (amount != null && amount >= 0) {
                            credit = Math.addExact(credit, amount)
                            found = true
                        }
                    }
                }
            }
            SmsBalance(if (found) credit else null, null)
        } catch (_: RestClientException) {
            SmsBalance(null, null)
        } catch (_: ArithmeticException) {
            SmsBalance(null, null)
        }

    companion object {
        private val PROVIDER_CODE = Regex("[0-9]{2,3}")
    }
}
