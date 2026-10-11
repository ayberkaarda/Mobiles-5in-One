package app.cetele.server.reminders.delivery

import app.cetele.server.auth.ratelimit.RateLimit
import app.cetele.server.auth.ratelimit.RateLimiter
import app.cetele.server.config.ClientIp
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import jakarta.servlet.http.HttpServletRequest
import org.slf4j.LoggerFactory
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RestController

/**
 * `POST /v1/webhooks/sms-dlr` (ADR-0032). The caller holds no access token: the credential is the
 * HMAC over the raw body. The method takes the servlet request only, reads the bytes itself under
 * a hard cap, verifies them, and only then parses. Every failed credential answers the same
 * `401 webhook.unauthenticated`; the reason goes to the log as `outcome=<reason>`.
 */
@RestController
class SmsDeliveryWebhookController(
    private val properties: SmsDlrProperties,
    private val verifier: DlrSignatureVerifier,
    private val parser: DeliveryReportParser,
    private val service: DeliveryReportService,
    private val rateLimiter: RateLimiter,
) {
    private val log = LoggerFactory.getLogger(SmsDeliveryWebhookController::class.java)

    @PostMapping("/v1/webhooks/sms-dlr")
    fun receiveSmsDlr(request: HttpServletRequest): ResponseEntity<Void> {
        val address = ClientIp.of(request)
        if (!properties.allowlist.allows(address)) reject("ip_not_allowed")
        rateLimiter.consume(RateLimit.WEBHOOK_DLR_IP, address)
        val body = readBody(request)
        val check = verifier.check(request.getHeader(TIMESTAMP_HEADER), request.getHeader(SIGNATURE_HEADER), body)
        if (check != DlrCheck.OK) reject(check.outcome)
        val accepted = service.accept(parser.parse(body))
        log.info("Sms dlr webhook outcome={}", if (accepted == DeliveryAccept.STORED) "accepted" else "duplicate")
        return ResponseEntity.ok().build()
    }

    private fun readBody(request: HttpServletRequest): ByteArray {
        if (request.contentLengthLong > MAX_BODY_BYTES) throw ProblemException(ProblemCode.PAYLOAD_TOO_LARGE, "body over the limit")
        val bytes = request.inputStream.readNBytes(MAX_BODY_BYTES + 1)
        if (bytes.size > MAX_BODY_BYTES) throw ProblemException(ProblemCode.PAYLOAD_TOO_LARGE, "body over the limit")
        return bytes
    }

    private fun reject(reason: String): Nothing {
        log.info("Sms dlr webhook outcome={}", reason)
        throw ProblemException(ProblemCode.WEBHOOK_UNAUTHENTICATED, reason)
    }

    companion object {
        const val MAX_BODY_BYTES = 8 * 1024
        const val TIMESTAMP_HEADER = "X-Cetele-Timestamp"
        const val SIGNATURE_HEADER = "X-Cetele-Signature"
    }
}
