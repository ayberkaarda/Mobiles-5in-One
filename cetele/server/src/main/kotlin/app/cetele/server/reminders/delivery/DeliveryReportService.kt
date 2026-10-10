package app.cetele.server.reminders.delivery

import com.github.benmanes.caffeine.cache.Caffeine
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.Duration

enum class DeliveryAccept { STORED, DUPLICATE }

/**
 * Stores an authenticated delivery report once per provider message id: first a Caffeine replay
 * cache (10 minutes, 100 000 entries), then the unique index of `sms_delivery_reports`, which is
 * the durable guard and also closes the gap after a restart.
 */
@Service
class DeliveryReportService(
    private val reports: SmsDeliveryReportRepository,
    private val processor: DeliveryReportProcessor,
    private val clock: Clock,
    transactionManager: PlatformTransactionManager,
) {
    private val transaction =
        TransactionTemplate(transactionManager).apply {
            propagationBehavior = TransactionDefinition.PROPAGATION_REQUIRES_NEW
        }
    private val seen =
        Caffeine
            .newBuilder()
            .maximumSize(CACHE_SIZE)
            .expireAfterWrite(CACHE_TTL)
            .build<String, Boolean>()

    fun accept(report: ParsedDeliveryReport): DeliveryAccept {
        if (seen.getIfPresent(report.providerMessageId) != null) return DeliveryAccept.DUPLICATE
        val id =
            try {
                transaction.execute {
                    if (reports.existsByProviderMessageId(report.providerMessageId)) {
                        null
                    } else {
                        val row =
                            SmsDeliveryReport(
                                report.providerMessageId,
                                report.status,
                                report.errorCode,
                                report.occurredAt,
                                clock.instant(),
                            )
                        checkNotNull(reports.saveAndFlush(row).id)
                    }
                }
            } catch (_: DataIntegrityViolationException) {
                null
            }
        seen.put(report.providerMessageId, true)
        if (id == null) return DeliveryAccept.DUPLICATE
        processor.submit(id)
        return DeliveryAccept.STORED
    }

    private companion object {
        const val CACHE_SIZE = 100_000L
        val CACHE_TTL: Duration = Duration.ofMinutes(10)
    }
}
