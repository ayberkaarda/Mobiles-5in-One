package app.cetele.server.web.problem

import org.springframework.http.HttpStatus
import java.net.URI

/**
 * The error code registry. Every error response carries exactly one of these codes; clients map
 * [code] to their own (Turkish) text, so [title] stays a short generic English phrase.
 *
 * Append-only: codes are a public contract with the Android app. Never rename or remove an entry.
 */
enum class ProblemCode(
    val code: String,
    val status: HttpStatus,
    val title: String,
) {
    AUTH_UNAUTHENTICATED("auth.unauthenticated", HttpStatus.UNAUTHORIZED, "Authentication required"),
    AUTH_INTEGRITY_REQUIRED("auth.integrity_required", HttpStatus.FORBIDDEN, "Integrity token required"),
    AUTH_INTEGRITY_INVALID("auth.integrity_invalid", HttpStatus.FORBIDDEN, "Integrity check failed"),

    /** Wrong, expired, consumed and exhausted codes all produce this same response. */
    AUTH_OTP_INVALID("auth.otp_invalid", HttpStatus.UNAUTHORIZED, "Invalid verification code"),
    AUTH_REFRESH_INVALID("auth.refresh_invalid", HttpStatus.UNAUTHORIZED, "Invalid refresh token"),
    FORBIDDEN("forbidden", HttpStatus.FORBIDDEN, "Forbidden"),
    NOT_FOUND("not_found", HttpStatus.NOT_FOUND, "Not found"),
    VALIDATION_FAILED("validation.failed", HttpStatus.UNPROCESSABLE_CONTENT, "Validation failed"),
    CONFLICT("conflict", HttpStatus.CONFLICT, "Conflict"),
    MEMBERSHIP_OWNER_LOCKED("membership.owner_locked", HttpStatus.CONFLICT, "Owner membership is locked"),
    MEMBERSHIP_ALREADY_MEMBER("membership.already_member", HttpStatus.CONFLICT, "Already a member"),
    RATE_LIMITED("rate_limited", HttpStatus.TOO_MANY_REQUESTS, "Too many requests"),
    PAYLOAD_TOO_LARGE("payload_too_large", HttpStatus.CONTENT_TOO_LARGE, "Payload too large"),
    UNSUPPORTED_MEDIA_TYPE("unsupported_media_type", HttpStatus.UNSUPPORTED_MEDIA_TYPE, "Unsupported media type"),
    SERVER_ERROR("server_error", HttpStatus.INTERNAL_SERVER_ERROR, "Internal server error"),
    ;

    /** `type` member of the RFC 9457 body. */
    val type: URI get() = URI.create(TYPE_BASE + code)

    companion object {
        const val TYPE_BASE = "https://cetele.app/problems/"

        fun fromCode(code: String): ProblemCode? = entries.firstOrNull { it.code == code }
    }
}
