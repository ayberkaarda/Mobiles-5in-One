package app.cetele.server.web.problem

import app.cetele.server.security.TraceIdFilter
import com.fasterxml.jackson.annotation.JsonInclude
import io.swagger.v3.oas.annotations.Hidden
import jakarta.servlet.RequestDispatcher
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import jakarta.validation.ConstraintViolation
import jakarta.validation.ConstraintViolationException
import org.slf4j.LoggerFactory
import org.springframework.boot.webmvc.error.ErrorController
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.http.converter.HttpMessageNotReadableException
import org.springframework.security.access.AccessDeniedException
import org.springframework.security.core.AuthenticationException
import org.springframework.stereotype.Component
import org.springframework.validation.BindException
import org.springframework.validation.FieldError
import org.springframework.web.HttpMediaTypeNotAcceptableException
import org.springframework.web.HttpMediaTypeNotSupportedException
import org.springframework.web.HttpRequestMethodNotSupportedException
import org.springframework.web.bind.MissingPathVariableException
import org.springframework.web.bind.MissingRequestHeaderException
import org.springframework.web.bind.MissingServletRequestParameterException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.method.annotation.HandlerMethodValidationException
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException
import org.springframework.web.servlet.HandlerMapping
import org.springframework.web.servlet.NoHandlerFoundException
import org.springframework.web.servlet.resource.NoResourceFoundException
import tools.jackson.core.JacksonException
import tools.jackson.databind.ObjectMapper
import tools.jackson.databind.exc.InvalidFormatException
import tools.jackson.databind.exc.MismatchedInputException
import tools.jackson.databind.exc.PropertyBindingException

/**
 * RFC 9457 body. Only these members are ever written: no `detail`, no exception class or
 * message, no stack trace and never a submitted value.
 */
@JsonInclude(JsonInclude.Include.NON_EMPTY)
data class ProblemBody(
    val type: String,
    val title: String,
    val status: Int,
    val code: String,
    val traceId: String?,
    val errors: List<ProblemFieldError> = emptyList(),
) {
    companion object {
        fun of(
            code: ProblemCode,
            traceId: String?,
            errors: List<ProblemFieldError> = emptyList(),
        ) = ProblemBody(code.type.toString(), code.title, code.status.value(), code.code, traceId, errors)
    }
}

/** Builds problem responses for MVC handlers and writes them directly from servlet filters. */
@Component
class ProblemWriter(
    private val objectMapper: ObjectMapper,
) {
    fun entity(
        request: HttpServletRequest?,
        code: ProblemCode,
        errors: List<ProblemFieldError> = emptyList(),
        headers: Map<String, String> = emptyMap(),
    ): ResponseEntity<ProblemBody> {
        val builder = ResponseEntity.status(code.status).contentType(MediaType.APPLICATION_PROBLEM_JSON)
        headers.forEach { (name, value) -> builder.header(name, value) }
        return builder.body(ProblemBody.of(code, TraceIdFilter.current(request), errors))
    }

    /** For filters, entry points and access-denied handlers that run outside Spring MVC. */
    fun write(
        request: HttpServletRequest,
        response: HttpServletResponse,
        code: ProblemCode,
        errors: List<ProblemFieldError> = emptyList(),
        headers: Map<String, String> = emptyMap(),
    ) {
        if (response.isCommitted) return
        response.resetBuffer()
        response.status = code.status.value()
        response.contentType = MediaType.APPLICATION_PROBLEM_JSON_VALUE
        headers.forEach { (name, value) -> response.setHeader(name, value) }
        response.outputStream.write(objectMapper.writeValueAsBytes(ProblemBody.of(code, TraceIdFilter.current(request), errors)))
        response.flushBuffer()
    }
}

/**
 * Maps every exception that reaches Spring MVC onto the registry in [ProblemCode]. Spring's own
 * exceptions (binding, unknown property, wrong media type, unknown route) are translated here,
 * so the default Spring problem bodies are never produced.
 */
@RestControllerAdvice
class ProblemHandler(
    private val writer: ProblemWriter,
) {
    private val log = LoggerFactory.getLogger(ProblemHandler::class.java)

    @ExceptionHandler(ProblemException::class)
    fun problem(
        ex: ProblemException,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemBody> = render(request, ex)

    @ExceptionHandler(BindException::class)
    fun binding(
        ex: BindException,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemBody> {
        val errors = ex.bindingResult.fieldErrors.map { ProblemFieldError(it.field, fieldErrorCode(it)) }
        return respond(request, ProblemCode.VALIDATION_FAILED, errors)
    }

    @ExceptionHandler(HandlerMethodValidationException::class)
    fun methodValidation(
        ex: HandlerMethodValidationException,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemBody> {
        val pathInvalid = ex.parameterValidationResults.any { it.methodParameter.hasParameterAnnotation(PathVariable::class.java) }
        if (pathInvalid) return respond(request, ProblemCode.NOT_FOUND)
        val errors =
            ex.parameterValidationResults.flatMap { result ->
                val name = result.methodParameter.parameterName ?: "request"
                result.resolvableErrors.map { error ->
                    val violation = runCatching { result.unwrap(error, ConstraintViolation::class.java) }.getOrNull()
                    ProblemFieldError(name, violation?.let { violationCode(it) } ?: FieldErrorCodes.INVALID_FORMAT)
                }
            }
        return respond(request, ProblemCode.VALIDATION_FAILED, errors)
    }

    @ExceptionHandler(ConstraintViolationException::class)
    fun constraintViolation(
        ex: ConstraintViolationException,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemBody> {
        val errors =
            ex.constraintViolations.map { violation ->
                ProblemFieldError(violation.propertyPath.lastOrNull()?.name ?: "request", violationCode(violation))
            }
        return respond(request, ProblemCode.VALIDATION_FAILED, errors)
    }

    @ExceptionHandler(HttpMessageNotReadableException::class)
    fun unreadable(
        ex: HttpMessageNotReadableException,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemBody> {
        causeOfType<ProblemException>(ex)?.let { return render(request, it) }
        val jackson = causeOfType<JacksonException>(ex)
        val field = jackson?.let { jsonPath(it) }?.takeIf { it.isNotEmpty() }
        val fieldCode =
            when {
                jackson is PropertyBindingException -> FieldErrorCodes.UNKNOWN_PROPERTY
                jackson is InvalidFormatException -> FieldErrorCodes.INVALID_FORMAT
                jackson is MismatchedInputException && isMissingValue(jackson) -> FieldErrorCodes.REQUIRED
                else -> FieldErrorCodes.INVALID_FORMAT
            }
        val errors = if (field != null) listOf(ProblemFieldError(field, fieldCode)) else emptyList()
        return respond(request, ProblemCode.VALIDATION_FAILED, errors)
    }

    @ExceptionHandler(MissingServletRequestParameterException::class, MissingRequestHeaderException::class)
    fun missingParameter(
        ex: Exception,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemBody> {
        val name =
            when (ex) {
                is MissingServletRequestParameterException -> ex.parameterName
                is MissingRequestHeaderException -> ex.headerName
                else -> "request"
            }
        return respond(request, ProblemCode.VALIDATION_FAILED, listOf(ProblemFieldError(name, FieldErrorCodes.REQUIRED)))
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException::class)
    fun typeMismatch(
        ex: MethodArgumentTypeMismatchException,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemBody> {
        // A malformed id in the path addresses nothing: same answer as an unknown resource.
        if (ex.parameter.hasParameterAnnotation(PathVariable::class.java)) return respond(request, ProblemCode.NOT_FOUND)
        return respond(request, ProblemCode.VALIDATION_FAILED, listOf(ProblemFieldError(ex.name, FieldErrorCodes.INVALID_FORMAT)))
    }

    @ExceptionHandler(
        NoResourceFoundException::class,
        NoHandlerFoundException::class,
        HttpRequestMethodNotSupportedException::class,
        MissingPathVariableException::class,
    )
    fun notFound(request: HttpServletRequest): ResponseEntity<ProblemBody> = respond(request, ProblemCode.NOT_FOUND)

    @ExceptionHandler(HttpMediaTypeNotSupportedException::class, HttpMediaTypeNotAcceptableException::class)
    fun mediaType(request: HttpServletRequest): ResponseEntity<ProblemBody> = respond(request, ProblemCode.UNSUPPORTED_MEDIA_TYPE)

    @ExceptionHandler(AuthenticationException::class)
    fun unauthenticated(request: HttpServletRequest): ResponseEntity<ProblemBody> = respond(request, ProblemCode.AUTH_UNAUTHENTICATED)

    @ExceptionHandler(AccessDeniedException::class)
    fun forbidden(
        ex: AccessDeniedException,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemBody> {
        // A permission check that found no membership throws not_found from inside the expression.
        causeOfType<ProblemException>(ex)?.let { return render(request, it) }
        return respond(request, ProblemCode.FORBIDDEN)
    }

    @ExceptionHandler(Exception::class)
    fun unexpected(
        ex: Exception,
        request: HttpServletRequest,
    ): ResponseEntity<ProblemBody> {
        causeOfType<ProblemException>(ex)?.let { return render(request, it) }
        log.error("Unhandled exception on {} {}", request.method, route(request), ex)
        return respond(request, ProblemCode.SERVER_ERROR)
    }

    private fun render(
        request: HttpServletRequest,
        ex: ProblemException,
    ): ResponseEntity<ProblemBody> {
        if (ex.code.status.is5xxServerError) {
            log.error("Problem {} on {} {}: {}", ex.code.code, request.method, route(request), ex.detail)
        } else {
            log.debug("Problem {} on {} {}: {}", ex.code.code, request.method, route(request), ex.detail)
        }
        return writer.entity(request, ex.code, ex.errors, ex.headers)
    }

    private fun respond(
        request: HttpServletRequest,
        code: ProblemCode,
        errors: List<ProblemFieldError> = emptyList(),
    ): ResponseEntity<ProblemBody> {
        log.debug("Problem {} on {} {}", code.code, request.method, route(request))
        return writer.entity(request, code, errors)
    }

    companion object {
        /**
         * The matched route pattern (`/v1/invitations/{code}/accept`), never the raw URL: paths can
         * carry secrets such as invitation codes. Unmatched requests are logged as `<unmatched>`.
         */
        fun route(request: HttpServletRequest): String =
            request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE) as? String ?: "<unmatched>"

        /** Field error code for a binding error, derived from the constraint annotation only. */
        fun fieldErrorCode(error: FieldError): String {
            val violation = runCatching { error.unwrap(ConstraintViolation::class.java) }.getOrNull()
            return violation?.let { violationCode(it) } ?: FieldErrorCodes.INVALID_FORMAT
        }

        fun violationCode(violation: ConstraintViolation<*>): String {
            val annotation = violation.constraintDescriptor.annotation
            return when (annotation.annotationClass.simpleName) {
                "NotNull", "NotBlank", "NotEmpty" -> FieldErrorCodes.REQUIRED

                "Size", "Length" -> sizeCode(violation.invalidValue)

                "Min", "Max", "DecimalMin", "DecimalMax", "Positive", "PositiveOrZero", "Negative", "NegativeOrZero",
                "Range", "Digits", "Past", "PastOrPresent", "Future", "FutureOrPresent",
                -> FieldErrorCodes.OUT_OF_RANGE

                else -> FieldErrorCodes.INVALID_FORMAT
            }
        }

        private fun sizeCode(value: Any?): String {
            val length =
                when (value) {
                    is CharSequence -> value.length
                    is Collection<*> -> value.size
                    is Map<*, *> -> value.size
                    is Array<*> -> value.size
                    else -> return FieldErrorCodes.OUT_OF_RANGE
                }
            // Size violations of an empty value mean "missing"; anything else is over the maximum.
            return if (length == 0) FieldErrorCodes.REQUIRED else FieldErrorCodes.TOO_LONG
        }

        private fun isMissingValue(ex: MismatchedInputException): Boolean {
            val name = ex.javaClass.simpleName
            return name.contains("InvalidNull") || name.contains("MissingKotlinParameter")
        }

        private fun jsonPath(ex: JacksonException): String =
            ex.path
                .joinToString("") { reference ->
                    when {
                        reference.propertyName != null -> "." + reference.propertyName
                        reference.index >= 0 -> "[" + reference.index + "]"
                        else -> ""
                    }
                }.removePrefix(".")

        private inline fun <reified T : Throwable> causeOfType(ex: Throwable): T? {
            var current: Throwable? = ex
            var depth = 0
            while (current != null && depth < MAX_CAUSE_DEPTH) {
                if (current is T) return current
                current = current.cause
                depth++
            }
            return null
        }

        private const val MAX_CAUSE_DEPTH = 10
    }
}

/**
 * Replaces Spring Boot's error controller, so a container-level error dispatch (an exception
 * escaping a filter, `sendError`) is also answered with a registry problem body.
 */
@Hidden
@RestController
class ProblemErrorController(
    private val writer: ProblemWriter,
) : ErrorController {
    @RequestMapping("\${server.error.path:/error}")
    fun error(request: HttpServletRequest): ResponseEntity<ProblemBody> {
        val exception = request.getAttribute(RequestDispatcher.ERROR_EXCEPTION) as? Throwable
        val problem = generateSequence(exception) { it.cause }.take(10).filterIsInstance<ProblemException>().firstOrNull()
        if (problem != null) return writer.entity(request, problem.code, problem.errors, problem.headers)
        val status = request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE) as? Int ?: 500
        return writer.entity(request, codeForStatus(status))
    }

    companion object {
        fun codeForStatus(status: Int): ProblemCode =
            when (status) {
                400, 422 -> ProblemCode.VALIDATION_FAILED
                401 -> ProblemCode.AUTH_UNAUTHENTICATED
                403 -> ProblemCode.FORBIDDEN
                404, 405 -> ProblemCode.NOT_FOUND
                409 -> ProblemCode.CONFLICT
                413 -> ProblemCode.PAYLOAD_TOO_LARGE
                415, 406 -> ProblemCode.UNSUPPORTED_MEDIA_TYPE
                429 -> ProblemCode.RATE_LIMITED
                else -> ProblemCode.SERVER_ERROR
            }
    }
}
