package app.cetele.server.billing.webhook

import app.cetele.server.auth.ratelimit.RateLimit
import app.cetele.server.auth.ratelimit.RateLimiter
import app.cetele.server.config.ClientIp
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import jakarta.servlet.http.HttpServletRequest
import org.slf4j.LoggerFactory
import org.springframework.http.HttpHeaders
import org.springframework.http.ResponseEntity
import org.springframework.stereotype.Component
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RestController
import tools.jackson.databind.ObjectMapper
import java.time.Clock

/**
 * The checks of `POST /v1/webhooks/play-rtdn` in the order of ADR-0032: rate bucket and size cap,
 * the push token on the raw request, then the envelope. Every credential failure is the same
 * `401 webhook.unauthenticated`; the reason only reaches the log. Accepted, duplicate, ignored
 * and malformed-but-authenticated deliveries all end with 200.
 */
@Component
class PlayRtdnWebhook(
    private val limiter: RateLimiter,
    private val verifier: RtdnTokenVerifier,
    private val inbox: RtdnInbox,
    private val processor: RtdnProcessor,
    private val mapper: ObjectMapper,
    private val clock: Clock,
) {
    private val log = LoggerFactory.getLogger(PlayRtdnWebhook::class.java)

    fun receive(request: HttpServletRequest) {
        limiter.consume(RateLimit.WEBHOOK_RTDN_IP, ClientIp.of(request))
        val body = readCapped(request)
        verifier.reject(request.getHeader(HttpHeaders.AUTHORIZATION))?.let { rejection ->
            log.info("Rtdn webhook outcome={}", rejection.label)
            throw ProblemException(ProblemCode.WEBHOOK_UNAUTHENTICATED, "rtdn push token refused")
        }
        val message = RtdnEnvelope.parse(body, mapper)
        if (message == null) {
            log.info("Rtdn webhook outcome=malformed")
            return
        }
        if (inbox.store(message, clock.instant()) == RtdnReceipt.STORED) processor.triggerSoon()
    }

    private fun readCapped(request: HttpServletRequest): ByteArray {
        if (request.contentLengthLong > MAX_BODY_BYTES) tooLarge()
        val bytes = request.inputStream.readNBytes(MAX_BODY_BYTES + 1)
        if (bytes.size > MAX_BODY_BYTES) tooLarge()
        return bytes
    }

    private fun tooLarge(): Nothing {
        log.info("Rtdn webhook outcome=too_large")
        throw ProblemException(ProblemCode.PAYLOAD_TOO_LARGE, "rtdn body over the cap")
    }

    companion object {
        const val MAX_BODY_BYTES = 64 * 1024
    }
}

/** Google Play Real-time Developer Notifications through a Pub/Sub push subscription (ADR-0032). */
@RestController
class PlayRtdnWebhookController(
    private val webhook: PlayRtdnWebhook,
) {
    @PostMapping(RtdnExpectations.PATH)
    fun receivePlayRtdn(request: HttpServletRequest): ResponseEntity<Void> {
        webhook.receive(request)
        return ResponseEntity.ok().build()
    }
}
