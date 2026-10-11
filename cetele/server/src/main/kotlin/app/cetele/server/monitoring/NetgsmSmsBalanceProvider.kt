package app.cetele.server.monitoring

import app.cetele.server.reminders.sms.NetgsmProperties
import org.slf4j.LoggerFactory
import org.springframework.http.MediaType
import org.springframework.web.client.ResourceAccessException
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientException
import org.springframework.web.client.RestClientResponseException
import tools.jackson.core.JacksonException
import tools.jackson.databind.JsonNode

/**
 * Netgsm package balance (`POST /balance`, `stip=1`), shaped after the provider documentation and
 * not verified against the live API. The credit is the sum of the `Adet SMS` packages. The read
 * fails closed: an error code, a missing SMS package or any amount that is not a non-negative
 * integer makes the whole reading [SmsBalanceReading.Unknown], never zero and never a partial sum.
 */
class NetgsmSmsBalanceProvider(
    private val client: RestClient,
    private val properties: NetgsmProperties,
) : SmsBalanceProvider {
    private val log = LoggerFactory.getLogger(NetgsmSmsBalanceProvider::class.java)

    override fun read(): SmsBalanceReading {
        val reading =
            try {
                val response =
                    client
                        .post()
                        .uri("/balance")
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(mapOf("usercode" to properties.username, "password" to properties.password, "stip" to 1))
                        .retrieve()
                        .body(JsonNode::class.java)
                parse(response)
            } catch (failure: RestClientResponseException) {
                SmsBalanceReading.Unknown("http_${failure.statusCode.value()}")
            } catch (_: ResourceAccessException) {
                SmsBalanceReading.Unknown("transport_error")
            } catch (_: RestClientException) {
                SmsBalanceReading.Unknown(INVALID)
            } catch (_: JacksonException) {
                SmsBalanceReading.Unknown(INVALID)
            }
        when (reading) {
            is SmsBalanceReading.Known -> log.info("SMS balance netgsm outcome=read credit={}", reading.credit)
            is SmsBalanceReading.Unknown -> log.warn("SMS balance netgsm outcome=unknown reason={}", reading.reason)
        }
        return reading
    }

    private fun parse(response: JsonNode?): SmsBalanceReading {
        if (response == null || !response.isObject) return SmsBalanceReading.Unknown(INVALID)
        val packages = response.get("balance")
        if (packages == null || !packages.isArray) {
            val code =
                response
                    .get("code")
                    ?.takeIf { it.isString || it.isIntegralNumber }
                    ?.asString()
                    .orEmpty()
            return SmsBalanceReading.Unknown(if (PROVIDER_CODE.matches(code)) "provider_$code" else INVALID)
        }
        var credit = 0L
        var found = false
        for (index in 0 until packages.size()) {
            val pack = packages.get(index)
            if (!pack.isObject) return SmsBalanceReading.Unknown(INVALID)
            if (pack.get("balance_name")?.asString() != SMS_PACKAGE) continue
            val amount = amount(pack.get("amount")) ?: return SmsBalanceReading.Unknown(INVALID)
            credit =
                try {
                    Math.addExact(credit, amount)
                } catch (_: ArithmeticException) {
                    return SmsBalanceReading.Unknown(INVALID)
                }
            found = true
        }
        return if (found) SmsBalanceReading.Known(credit) else SmsBalanceReading.Unknown("no_sms_package")
    }

    private fun amount(node: JsonNode?): Long? {
        val value =
            when {
                node == null -> {
                    null
                }

                node.isIntegralNumber && node.canConvertToLong() -> {
                    node.asLong()
                }

                node.isString -> {
                    node
                        .asString()
                        .trim()
                        .takeIf { DIGITS.matches(it) }
                        ?.toLongOrNull()
                }

                else -> {
                    null
                }
            }
        return value?.takeIf { it >= 0 }
    }

    companion object {
        const val SMS_PACKAGE = "Adet SMS"
        private const val INVALID = "invalid_response"
        private val PROVIDER_CODE = Regex("[0-9]{2,3}")
        private val DIGITS = Regex("[0-9]{1,18}")
    }
}
