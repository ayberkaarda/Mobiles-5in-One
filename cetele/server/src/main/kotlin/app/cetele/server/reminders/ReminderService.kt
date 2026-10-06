package app.cetele.server.reminders

import app.cetele.server.config.logging.Masking
import app.cetele.server.ledger.customer.CustomerRepository
import app.cetele.server.ledger.entry.LedgerEntryRepository
import app.cetele.server.ledger.money.Balance
import app.cetele.server.reminders.quota.QuotaState
import app.cetele.server.reminders.quota.SmsQuotaService
import app.cetele.server.reminders.sms.SmsGateway
import app.cetele.server.reminders.sms.SmsKind
import app.cetele.server.reminders.sms.SmsMessage
import app.cetele.server.reminders.sms.SmsSendResult
import app.cetele.server.reminders.template.ReminderTemplates
import app.cetele.server.statements.link.StatementLinkService
import app.cetele.server.tenancy.shop.ShopRepository
import app.cetele.server.web.problem.FieldErrorCodes
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import app.cetele.server.web.problem.ProblemFieldError
import com.fasterxml.jackson.annotation.JsonInclude
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.Instant
import java.util.UUID

data class ReminderRequest(
    val customerId: UUID,
    val channel: String,
    val template: String,
)

data class ReminderResponse(
    val reminderId: UUID,
    val status: String,
    val sentAt: Instant,
    @get:JsonInclude(JsonInclude.Include.NON_NULL)
    val providerMessageId: String?,
    val quota: QuotaState,
)

@Service
class ReminderService(
    private val reminders: ReminderRepository,
    private val customers: CustomerRepository,
    private val entries: LedgerEntryRepository,
    private val shops: ShopRepository,
    private val quota: SmsQuotaService,
    private val links: StatementLinkService,
    private val gateway: SmsGateway,
    private val clock: Clock,
    transactionManager: PlatformTransactionManager,
) {
    private val log = LoggerFactory.getLogger(ReminderService::class.java)
    private val transaction =
        TransactionTemplate(transactionManager).apply {
            propagationBehavior = TransactionDefinition.PROPAGATION_REQUIRES_NEW
        }

    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    fun send(
        shopId: UUID,
        requestedBy: UUID,
        request: ReminderRequest,
    ): ReminderResponse {
        val errors =
            buildList {
                if (request.channel != "SMS") add(ProblemFieldError("channel", FieldErrorCodes.OUT_OF_RANGE))
                if (request.template != "BALANCE") add(ProblemFieldError("template", FieldErrorCodes.OUT_OF_RANGE))
            }
        if (errors.isNotEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, errors = errors)
        val queued =
            checkNotNull(
                transaction.execute {
                    val now = clock.instant()
                    // Match the ledger and link lock order, and resolve the customer under that lock.
                    val shop = shops.lockActive(shopId) ?: throw ProblemException(ProblemCode.NOT_FOUND)
                    val customer = customers.findActive(shopId, request.customerId) ?: throw ProblemException(ProblemCode.NOT_FOUND)
                    val phone = customer.phoneE164 ?: throw ProblemException(ProblemCode.SMS_PHONE_MISSING)
                    if (!customer.smsConsent) throw ProblemException(ProblemCode.SMS_CONSENT_MISSING)
                    val balance = Balance.of(entries.balanceLines(shopId, customer.id))
                    if (balance <= 0) throw ProblemException(ProblemCode.REMINDER_NO_BALANCE)
                    quota.requireDailyCap(now)
                    val reserved = quota.reserve(shopId, shop.plan, now)
                    val link = links.issue(shopId, customer.id, requestedBy, now = now)
                    val row = reminders.save(Reminder(shopId, customer.id, link.id, requestedBy, now))
                    Queued(checkNotNull(row.id), phone, ReminderTemplates.balance(customer.name, shop.name, balance, link.url), reserved)
                },
            )
        val result =
            try {
                gateway.send(SmsMessage(queued.phone, queued.text, SmsKind.REMINDER))
            } catch (_: Exception) {
                SmsSendResult.Failed("transport_failure")
            }
        val response =
            transaction.execute {
                val row = checkNotNull(reminders.findByShopIdAndId(shopId, queued.id))
                if (result is SmsSendResult.Accepted) {
                    val sentAt = clock.instant()
                    row.status = "SENT"
                    row.sentAt = sentAt
                    row.providerMessageId = result.providerMessageId
                    reminders.save(row)
                    ReminderResponse(queued.id, row.status, sentAt, row.providerMessageId, queued.quota)
                } else {
                    row.status = "FAILED"
                    row.failureCode = ProblemCode.SMS_PROVIDER_FAILED.code
                    reminders.save(row)
                    quota.refund(shopId, queued.quota.month)
                    null
                }
            }
        log.info(
            "Reminder shop={} reminder={} outcome={} to={}",
            shopId,
            queued.id,
            if (response == null) "failed" else "sent",
            Masking.phone(queued.phone),
        )
        return response ?: throw ProblemException(ProblemCode.SMS_PROVIDER_FAILED)
    }

    private data class Queued(
        val id: UUID,
        val phone: String,
        val text: String,
        val quota: QuotaState,
    )
}
