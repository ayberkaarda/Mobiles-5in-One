package app.cetele.android.core.designsystem.copy

import androidx.annotation.StringRes
import app.cetele.android.core.designsystem.R
import app.cetele.android.core.network.dto.problem.ProblemCodes

object ProblemCodeText {
    private val resources =
        mapOf(
            ProblemCodes.AUTH_UNAUTHENTICATED to R.string.error_auth_unauthenticated,
            ProblemCodes.AUTH_INTEGRITY_REQUIRED to R.string.error_auth_integrity_required,
            ProblemCodes.AUTH_INTEGRITY_INVALID to R.string.error_auth_integrity_invalid,
            ProblemCodes.AUTH_OTP_INVALID to R.string.error_auth_otp_invalid,
            ProblemCodes.AUTH_REFRESH_INVALID to R.string.error_auth_refresh_invalid,
            ProblemCodes.AUTH_REAUTH_INVALID to R.string.error_auth_reauth_invalid,
            ProblemCodes.FORBIDDEN to R.string.error_forbidden,
            ProblemCodes.NOT_FOUND to R.string.error_not_found,
            ProblemCodes.VALIDATION_FAILED to R.string.error_validation_failed,
            ProblemCodes.CONFLICT to R.string.error_conflict,
            ProblemCodes.MEMBERSHIP_OWNER_LOCKED to R.string.error_membership_owner_locked,
            ProblemCodes.MEMBERSHIP_ALREADY_MEMBER to R.string.error_membership_already_member,
            ProblemCodes.RATE_LIMITED to R.string.error_rate_limited,
            ProblemCodes.PAYLOAD_TOO_LARGE to R.string.error_payload_too_large,
            ProblemCodes.UNSUPPORTED_MEDIA_TYPE to R.string.error_unsupported_media_type,
            ProblemCodes.SERVER_ERROR to R.string.error_server_error,
            ProblemCodes.CUSTOMER_DELETED to R.string.error_customer_deleted,
            ProblemCodes.LEDGER_ALREADY_REVERSED to R.string.error_ledger_already_reversed,
            ProblemCodes.LEDGER_REVERSAL_MISMATCH to R.string.error_ledger_reversal_mismatch,
            ProblemCodes.PLAN_CUSTOMER_LIMIT to R.string.error_plan_customer_limit,
            ProblemCodes.PLAN_PHOTO_LIMIT to R.string.error_plan_photo_limit,
            ProblemCodes.SMS_QUOTA_EXCEEDED to R.string.error_sms_quota_exceeded,
            ProblemCodes.SMS_DAILY_CAP_REACHED to R.string.error_sms_daily_cap_reached,
            ProblemCodes.SMS_CONSENT_MISSING to R.string.error_sms_consent_missing,
            ProblemCodes.SMS_PHONE_MISSING to R.string.error_sms_phone_missing,
            ProblemCodes.SMS_PROVIDER_FAILED to R.string.error_sms_provider_failed,
            ProblemCodes.REMINDER_NO_BALANCE to R.string.error_reminder_no_balance,
            ProblemCodes.STATEMENT_LINK_LIMIT to R.string.error_statement_link_limit,
            ProblemCodes.MEDIA_INVALID to R.string.error_media_invalid,
            ProblemCodes.MEDIA_NOT_UPLOADED to R.string.error_media_not_uploaded,
            ProblemCodes.MEDIA_TOO_LARGE to R.string.error_media_too_large,
            ProblemCodes.MEDIA_NOT_READY to R.string.error_media_not_ready,
            ProblemCodes.ACCOUNT_OWNER_OF_SHARED_SHOP to R.string.error_account_owner_of_shared_shop,
            ProblemCodes.ACCOUNT_DELETION_PENDING to R.string.error_account_deletion_pending,
            ProblemCodes.SHOP_DELETION_PENDING to R.string.error_shop_deletion_pending,
        )

    @StringRes
    fun resId(code: String?): Int? = resources[code]

    @StringRes
    fun resIdOrGeneric(code: String?): Int = resId(code) ?: R.string.error_generic
}
