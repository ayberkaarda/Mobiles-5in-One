package app.cetele.server.reminders.delivery

import app.cetele.server.web.problem.FieldErrorCodes
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import app.cetele.server.web.problem.ProblemFieldError
import org.springframework.stereotype.Component
import tools.jackson.core.JacksonException
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.format.DateTimeParseException

/** A validated delivery report envelope body (ADR-0032). */
data class ParsedDeliveryReport(
    val providerMessageId: String,
    val status: String,
    val occurredAt: Instant,
    val errorCode: String?,
)

/**
 * Parses the signed body. The caller is authenticated at this point, so a bad body answers
 * `422 validation.failed` with field codes (never the submitted values).
 */
@Component
class DeliveryReportParser(
    private val objectMapper: ObjectMapper,
    private val clock: Clock,
) {
    fun parse(body: ByteArray): ParsedDeliveryReport {
        val root =
            try {
                objectMapper.readTree(body)
            } catch (_: JacksonException) {
                null
            }
        if (root == null || !root.isObject) {
            throw invalid(ProblemFieldError("body", FieldErrorCodes.INVALID_FORMAT))
        }
        val errors = mutableListOf<ProblemFieldError>()
        root.propertyNames().forEach { name ->
            if (name !in
                FIELDS
            ) {
                errors += ProblemFieldError(if (SAFE_NAME.matches(name)) name else "body", FieldErrorCodes.UNKNOWN_PROPERTY)
            }
        }
        val id = text(root, "providerMessageId", errors, MESSAGE_ID, required = true)
        val status = text(root, "status", errors, null, required = true)
        if (status != null && status != SmsDeliveryReport.DELIVERED && status != SmsDeliveryReport.UNDELIVERED) {
            errors += ProblemFieldError("status", FieldErrorCodes.OUT_OF_RANGE)
        }
        val occurredText = text(root, "occurredAt", errors, null, required = true)
        var occurredAt: Instant? = null
        if (occurredText != null) {
            try {
                occurredAt = Instant.parse(occurredText)
                if (occurredAt.isAfter(clock.instant().plus(FUTURE_TOLERANCE))) {
                    errors += ProblemFieldError("occurredAt", FieldErrorCodes.OUT_OF_RANGE)
                }
            } catch (_: DateTimeParseException) {
                errors += ProblemFieldError("occurredAt", FieldErrorCodes.INVALID_FORMAT)
            }
        }
        val errorCode = text(root, "errorCode", errors, ERROR_CODE, required = false)
        if (errors.isNotEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, errors = errors)
        return ParsedDeliveryReport(checkNotNull(id), checkNotNull(status), checkNotNull(occurredAt), errorCode)
    }

    private fun text(
        root: JsonNode,
        field: String,
        errors: MutableList<ProblemFieldError>,
        pattern: Regex?,
        required: Boolean,
    ): String? {
        val node = root.get(field)
        if (node == null || node.isNull) {
            if (required) errors += ProblemFieldError(field, FieldErrorCodes.REQUIRED)
            return null
        }
        if (!node.isString) {
            errors += ProblemFieldError(field, FieldErrorCodes.INVALID_FORMAT)
            return null
        }
        val value = node.asString()
        if (value.isEmpty()) {
            errors += ProblemFieldError(field, FieldErrorCodes.REQUIRED)
            return null
        }
        if (pattern != null && !pattern.matches(value)) {
            errors +=
                ProblemFieldError(field, if (value.length > MAX_LENGTH_HINT) FieldErrorCodes.TOO_LONG else FieldErrorCodes.INVALID_FORMAT)
            return null
        }
        if (value.length > MAX_LENGTH_HINT) {
            errors += ProblemFieldError(field, FieldErrorCodes.TOO_LONG)
            return null
        }
        return value
    }

    private fun invalid(error: ProblemFieldError) = ProblemException(ProblemCode.VALIDATION_FAILED, errors = listOf(error))

    private companion object {
        val FIELDS = setOf("providerMessageId", "status", "occurredAt", "errorCode")
        val MESSAGE_ID = Regex("[A-Za-z0-9_.:-]{1,64}")
        val ERROR_CODE = Regex("[A-Za-z0-9_.-]{1,32}")
        val SAFE_NAME = Regex("[A-Za-z0-9_]{1,32}")
        val FUTURE_TOLERANCE: Duration = Duration.ofMinutes(5)
        const val MAX_LENGTH_HINT = 64
    }
}
