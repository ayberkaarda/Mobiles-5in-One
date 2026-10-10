package app.cetele.android.core.data.vault

interface Vault {
    fun get(key: String): ByteArray?

    fun put(
        key: String,
        value: ByteArray,
    )

    fun remove(key: String)

    fun clear()
}

object VaultKeys {
    const val DB_PASSPHRASE = "db_passphrase"
    const val PHOTO_KEY = "photo_key"
    const val REFRESH_TOKEN = "refresh_token"
    const val PIN_HASH = "pin_hash"
    const val PIN_SALT = "pin_salt"
    const val PIN_FAILURES = "pin_failures"
    const val PIN_DELAY_UNTIL = "pin_delay_until"
    const val USER_ID = "user_id"
    const val PHONE = "phone"
}
