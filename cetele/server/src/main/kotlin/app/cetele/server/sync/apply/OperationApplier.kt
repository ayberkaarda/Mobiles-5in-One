package app.cetele.server.sync.apply

import app.cetele.server.ledger.customer.Customer
import app.cetele.server.ledger.customer.CustomerRepository
import app.cetele.server.ledger.entry.LedgerEntry
import app.cetele.server.ledger.entry.LedgerEntryRepository
import app.cetele.server.security.CurrentUser
import app.cetele.server.security.Permission
import app.cetele.server.security.TraceIdFilter
import app.cetele.server.statements.link.StatementLinkService
import app.cetele.server.sync.CustomerView
import app.cetele.server.sync.EntryView
import app.cetele.server.sync.OperationKind
import app.cetele.server.sync.OperationResult
import app.cetele.server.sync.OperationStatus
import app.cetele.server.sync.SyncOperation
import app.cetele.server.sync.SyncValidation
import app.cetele.server.sync.changelog.ChangeLogWriter
import app.cetele.server.sync.changelog.ShopSequence
import app.cetele.server.tenancy.MembershipResolver
import app.cetele.server.tenancy.PlanLimits
import app.cetele.server.tenancy.shop.ShopRepository
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import tools.jackson.databind.ObjectMapper
import java.time.Clock
import java.time.Instant
import java.util.UUID

@Service
class OperationApplier(
    private val receipts: SyncOutboxReceiptRepository,
    private val customers: CustomerRepository,
    private val entries: LedgerEntryRepository,
    private val shops: ShopRepository,
    private val memberships: MembershipResolver,
    private val sequence: ShopSequence,
    private val changes: ChangeLogWriter,
    private val links: StatementLinkService,
    private val validation: SyncValidation,
    private val mapper: ObjectMapper,
    private val clock: Clock,
) {
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    fun apply(
        shopId: UUID,
        caller: CurrentUser,
        op: SyncOperation,
    ): OperationResult {
        // Keep the lock order consistent with statement-link issuance and shop deletion.
        val shop = shops.lockActive(shopId) ?: throw ProblemException(ProblemCode.NOT_FOUND)
        sequence.lock(shopId)
        receipts.findByShopIdAndClientId(shopId, op.clientId)?.let {
            return OperationResult(op.clientId, OperationStatus.DUPLICATE, it.entityId)
        }
        val context = memberships.resolve(shopId, caller)
        val permission =
            when (op.kind) {
                OperationKind.CUSTOMER_UPSERT -> Permission.CustomerWrite
                OperationKind.CUSTOMER_DELETE -> Permission.CustomerDelete
                OperationKind.ENTRY_CREATE -> Permission.LedgerWrite
            }
        if (!context.can(permission)) throw ProblemException(ProblemCode.FORBIDDEN)
        val errors = validation.fields(shopId, op)
        if (errors.isNotEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, errors = errors)
        if (receipts.findByShopIdAndDeviceIdAndClientSeq(shopId, caller.deviceId, op.clientSeq) != null) {
            throw ProblemException(ProblemCode.CONFLICT)
        }
        val now = clock.instant()
        val entityId =
            when (op.kind) {
                OperationKind.CUSTOMER_UPSERT -> {
                    val input = checkNotNull(op.customer)
                    val existing = customers.findByShopIdAndId(shopId, input.id)
                    if (existing == null && customers.existsOutsideShop(shopId, input.id)) throw ProblemException(ProblemCode.CONFLICT)
                    if (existing?.deletedAt != null) throw ProblemException(ProblemCode.CUSTOMER_DELETED)
                    val customer =
                        if (existing == null) {
                            if (customers.countLive(shopId) >=
                                PlanLimits.of(shop.plan).customers
                            ) {
                                throw ProblemException(ProblemCode.PLAN_CUSTOMER_LIMIT)
                            }
                            customers.insert(
                                shopId,
                                Customer(
                                    input.id,
                                    shopId,
                                    input.name,
                                    input.phone,
                                    input.note,
                                    input.tag,
                                    input.smsConsent,
                                    input.smsConsentAt,
                                    input.smsConsentSource,
                                    caller.userId,
                                    now,
                                    now,
                                    null,
                                ),
                            )
                        } else {
                            existing.apply {
                                name = input.name
                                phoneE164 = input.phone
                                note = input.note
                                tag = input.tag
                                smsConsent = input.smsConsent
                                smsConsentAt = input.smsConsentAt
                                smsConsentSource = input.smsConsentSource
                                updatedAt = now
                            }
                        }
                    appendCustomer(shopId, customer, "UPSERT")
                    input.id
                }

                OperationKind.CUSTOMER_DELETE -> {
                    val customer =
                        customers.findByShopIdAndId(shopId, checkNotNull(op.customerId)) ?: throw ProblemException(ProblemCode.NOT_FOUND)
                    if (customer.deletedAt == null) {
                        customer.deletedAt = now
                        customer.updatedAt = now
                        links.revokeForCustomer(shopId, customer.id, now)
                        appendCustomer(shopId, customer, "DELETE")
                    }
                    customer.id
                }

                OperationKind.ENTRY_CREATE -> {
                    createEntry(shopId, caller, op, now)
                }
            }
        receipts.save(
            SyncOutboxReceipt(TraceIdFilter.uuidV7(), shopId, caller.deviceId, caller.userId, op.clientSeq, op.clientId, entityId, now),
        )
        return OperationResult(op.clientId, OperationStatus.APPLIED, entityId)
    }

    private fun createEntry(
        shopId: UUID,
        caller: CurrentUser,
        op: SyncOperation,
        now: Instant,
    ): UUID {
        val input = checkNotNull(op.entry)
        val customer =
            customers.findByShopIdAndId(shopId, input.customerId) ?: run {
                if (customers.existsOutsideShop(shopId, input.customerId)) throw ProblemException(ProblemCode.CONFLICT)
                throw ProblemException(ProblemCode.NOT_FOUND)
            }
        if (customer.deletedAt != null) throw ProblemException(ProblemCode.CUSTOMER_DELETED)
        if (entries.findActiveByShopIdAndId(shopId, input.id) != null) throw ProblemException(ProblemCode.CONFLICT)
        val original =
            input.reverses?.let { id ->
                val entry = entries.findActiveByShopIdAndId(shopId, id) ?: throw ProblemException(ProblemCode.LEDGER_REVERSAL_MISMATCH)
                if (entry.customerId != input.customerId || entry.type != input.type || entry.amountMinor != input.amountMinor ||
                    entry.id == input.id ||
                    entry.reverses != null
                ) {
                    throw ProblemException(ProblemCode.LEDGER_REVERSAL_MISMATCH)
                }
                if (entry.reversedBy != null) throw ProblemException(ProblemCode.LEDGER_ALREADY_REVERSED)
                entry
            }
        val entry =
            entries.insert(
                shopId,
                LedgerEntry(
                    input.id,
                    shopId,
                    input.customerId,
                    op.clientId,
                    input.type,
                    input.amountMinor,
                    "TRY",
                    input.occurredOn,
                    input.dueOn,
                    input.note,
                    input.photoKey,
                    input.reverses,
                    null,
                    caller.userId,
                    now,
                ),
            )
        appendEntry(shopId, entry)
        if (original != null) {
            original.reversedBy = entry.id
            appendEntry(shopId, original)
        }
        return entry.id
    }

    private fun appendCustomer(
        shopId: UUID,
        customer: Customer,
        op: String,
    ) = changes.append(shopId, "CUSTOMER", customer.id, op, mapper.writeValueAsString(CustomerView.of(customer)))

    private fun appendEntry(
        shopId: UUID,
        entry: LedgerEntry,
    ) = changes.append(shopId, "ENTRY", entry.id, "UPSERT", mapper.writeValueAsString(EntryView.of(entry)))
}
