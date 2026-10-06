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
    AUTH_REAUTH_INVALID("auth.reauth_invalid", HttpStatus.FORBIDDEN, "Re-authentication failed"),
    CUSTOMER_DELETED("customer.deleted", HttpStatus.CONFLICT, "Customer is deleted"),
    LEDGER_ALREADY_REVERSED("ledger.already_reversed", HttpStatus.CONFLICT, "Entry is already reversed"),
    LEDGER_REVERSAL_MISMATCH("ledger.reversal_mismatch", HttpStatus.UNPROCESSABLE_CONTENT, "Reversal does not match the entry"),
    PLAN_CUSTOMER_LIMIT("plan.customer_limit", HttpStatus.CONFLICT, "Customer limit reached"),
    PLAN_PHOTO_LIMIT("plan.photo_limit", HttpStatus.CONFLICT, "Photo limit reached"),
    SMS_QUOTA_EXCEEDED("sms.quota_exceeded", HttpStatus.TOO_MANY_REQUESTS, "SMS quota exceeded"),
    SMS_DAILY_CAP_REACHED("sms.daily_cap_reached", HttpStatus.TOO_MANY_REQUESTS, "Daily SMS cap reached"),
    SMS_CONSENT_MISSING("sms.consent_missing", HttpStatus.CONFLICT, "SMS consent missing"),
    SMS_PHONE_MISSING("sms.phone_missing", HttpStatus.CONFLICT, "Customer has no phone number"),
    SMS_PROVIDER_FAILED("sms.provider_failed", HttpStatus.BAD_GATEWAY, "SMS could not be sent"),
    REMINDER_NO_BALANCE("reminder.no_balance", HttpStatus.CONFLICT, "Nothing to remind"),
    STATEMENT_LINK_LIMIT("statement.link_limit", HttpStatus.CONFLICT, "Statement link limit reached"),
    MEDIA_INVALID("media.invalid", HttpStatus.UNPROCESSABLE_CONTENT, "Invalid image"),
    MEDIA_NOT_UPLOADED("media.not_uploaded", HttpStatus.CONFLICT, "Upload not found"),
    MEDIA_TOO_LARGE("media.too_large", HttpStatus.CONTENT_TOO_LARGE, "Image too large"),
    MEDIA_NOT_READY("media.not_ready", HttpStatus.CONFLICT, "Image not ready"),
    ACCOUNT_OWNER_OF_SHARED_SHOP("account.owner_of_shared_shop", HttpStatus.CONFLICT, "Owner of a shop with other members"),
    ACCOUNT_DELETION_PENDING("account.deletion_pending", HttpStatus.CONFLICT, "Deletion already requested"),
    SHOP_DELETION_PENDING("shop.deletion_pending", HttpStatus.CONFLICT, "Shop deletion already requested"),
    ;

    /** `type` member of the RFC 9457 body. */
    val type: URI get() = URI.create(TYPE_BASE + code)

    companion object {
        const val TYPE_BASE = "https://cetele.app/problems/"

        fun fromCode(code: String): ProblemCode? = entries.firstOrNull { it.code == code }
    }
}
