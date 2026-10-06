package app.cetele.server.web.validation

import jakarta.validation.Constraint
import jakarta.validation.Payload
import jakarta.validation.ReportAsSingleViolation
import jakarta.validation.constraints.Pattern
import kotlin.reflect.KClass

/**
 * A Turkish mobile number in E.164 form: `+905` followed by nine digits. `null` is valid; combine
 * with a non-null type when the field is required. Reported as field error `invalid_format`.
 */
@MustBeDocumented
@Target(AnnotationTarget.FIELD, AnnotationTarget.VALUE_PARAMETER, AnnotationTarget.PROPERTY_GETTER)
@Retention(AnnotationRetention.RUNTIME)
@Constraint(validatedBy = [])
@ReportAsSingleViolation
@Pattern(regexp = E164Tr.REGEX)
annotation class E164Tr(
    val message: String = "invalid_format",
    val groups: Array<KClass<*>> = [],
    val payload: Array<KClass<out Payload>> = [],
) {
    companion object {
        const val REGEX = "^\\+90[5][0-9]{9}$"
    }
}

/** Length limits shared by DTOs (spec section 6 item 6). */
object FieldLimits {
    const val NAME_MIN = 1

    /** Display names and shop names. */
    const val NAME_MAX = 80

    /** Ledger and customer notes (Phase 2). */
    const val NOTE_MAX = 500
}
