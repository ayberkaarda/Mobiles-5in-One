package app.cetele.android.core.domain.validation

object Limits {
    const val NAME_MAX = 80
    const val NOTE_MAX = 500
    const val TAG_MAX = 30
    const val AMOUNT_MIN = 1L
    const val AMOUNT_MAX = 10_000_000_000L
    const val SYNC_BATCH_MAX = 500
    const val PHOTO_MAX_BYTES = 1_200_000
    const val PHOTO_MAX_SIDE = 1600
    const val OTP_LENGTH = 6
    const val PIN_LENGTH = 6
    const val DISPLAY_NAME_MAX = 80
    const val APP_VERSION_MAX = 32
    const val MODEL_MAX = 100
}
