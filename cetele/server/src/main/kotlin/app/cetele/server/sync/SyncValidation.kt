package app.cetele.server.sync

import app.cetele.server.config.CeteleTime
import app.cetele.server.web.problem.FieldErrorCodes
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import app.cetele.server.web.problem.ProblemFieldError
import jakarta.validation.ConstraintViolation
import jakarta.validation.Validator
import jakarta.validation.constraints.Size
import org.springframework.stereotype.Component
import java.time.Clock
import java.util.UUID

@Component
class SyncValidation(
    private val validator: Validator,
    private val clock: Clock,
) {
    fun batch(request: PushRequest) {
        val errors = mutableListOf<ProblemFieldError>()
        if (request.operations.size > 500) errors += ProblemFieldError("operations", "too_long")
        val ids = mutableSetOf<UUID>()
        var previous = 0L
        request.operations.forEachIndexed { i, op ->
            val prefix = "operations[$i]"
            if (op.clientSeq < 1) {
                errors += ProblemFieldError("$prefix.clientSeq", "out_of_range")
            } else if (op.clientSeq <= previous) {
                errors += ProblemFieldError("$prefix.clientSeq", "out_of_order")
            }
            previous = op.clientSeq
            if (!ids.add(op.clientId)) errors += ProblemFieldError("$prefix.clientId", "invalid_format")
            val shape =
                when (op.kind) {
                    OperationKind.CUSTOMER_UPSERT -> op.customer != null && op.customerId == null && op.entry == null
                    OperationKind.CUSTOMER_DELETE -> op.customerId != null && op.customer == null && op.entry == null
                    OperationKind.ENTRY_CREATE -> op.entry != null && op.customer == null && op.customerId == null
                }
            if (!shape) errors += ProblemFieldError(prefix, "invalid_format")
        }
        if (errors.isNotEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, errors = errors)
    }

    fun fields(
        shopId: UUID,
        op: SyncOperation,
    ): List<ProblemFieldError> {
        val errors = mutableListOf<ProblemFieldError>()

        fun add(
            field: String,
            code: String = "invalid_format",
        ) {
            errors += ProblemFieldError(field, code)
        }
        op.customer?.let { c ->
            validator.validate(c).forEach { errors += ProblemFieldError("customer.${it.propertyPath}", code(it)) }
            if (c.smsConsentSource != null &&
                c.smsConsentSource !in setOf("IN_PERSON", "PHONE", "WRITTEN", "OTHER")
            ) {
                add("customer.smsConsentSource")
            }
            if (c.smsConsent && c.smsConsentAt == null) add("customer.smsConsentAt", "required")
            if (c.smsConsent && c.smsConsentSource == null) add("customer.smsConsentSource", "required")
        }
        op.entry?.let { e ->
            validator.validate(e).forEach { errors += ProblemFieldError("entry.${it.propertyPath}", code(it)) }
            if (e.type !in setOf("DEBT", "PAYMENT")) add("entry.type")
            if (e.dueOn != null && e.type != "DEBT") add("entry.dueOn")
            if (e.occurredOn > CeteleTime.today(clock).plusDays(1)) add("entry.occurredOn", "out_of_range")
            if (e.photoKey != null &&
                !Regex("^media/$shopId/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpg$").matches(e.photoKey)
            ) {
                add("entry.photoKey")
            }
            if (e.reverses != null) {
                if (e.dueOn != null) add("entry.dueOn")
                if (e.photoKey != null) add("entry.photoKey")
            }
        }
        return errors.distinct().sortedWith(compareBy({ it.field }, { it.code }))
    }

    /**
     * Field code of one violation. Custom constraints carry their code as the message; a size
     * violation of an empty value means "missing", like the request-level handler reports it.
     */
    private fun code(violation: ConstraintViolation<*>): String {
        val value = violation.invalidValue
        val isSize = violation.constraintDescriptor.annotation is Size
        return when {
            isSize && value is CharSequence && value.isEmpty() -> FieldErrorCodes.REQUIRED
            isSize -> FieldErrorCodes.TOO_LONG
            else -> violation.message
        }
    }
}
