package app.cetele.android.core.data.backup

import app.cetele.android.core.domain.model.ConsentSource
import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.core.domain.validation.CustomerValidator
import app.cetele.android.core.domain.validation.Limits
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeParseException
import java.util.Locale
import java.util.UUID

/**
 * Structural checks on a decrypted snapshot. The passphrase only proves who made the file, so its
 * rows go through the same field limits as a local write before anything touches the database. One
 * small predicate per rule keeps each check readable, hence the function count.
 */
@Suppress("TooManyFunctions")
internal object BackupValidator {
    fun isValid(snapshot: BackupSnapshot): Boolean =
        snapshot.schema == BackupSnapshot.SCHEMA &&
            snapshot.shopId.isNotBlank() &&
            snapshot.shopId.length <= SHOP_ID_MAX &&
            snapshot.shopName.length <= Limits.NAME_MAX &&
            instant(snapshot.exportedAt) &&
            snapshot.customers.all(::validCustomer) &&
            snapshot.entries.all(::validEntry) &&
            uniqueIds(snapshot) &&
            linksHold(snapshot)

    private fun validCustomer(row: BackupCustomer): Boolean {
        val source = row.smsConsentSource?.let { name -> ConsentSource.entries.firstOrNull { it.name == name } }
        val consentReadable =
            (row.smsConsentSource == null || source != null) && optional(row.smsConsentAt, ::instant)
        return consentReadable &&
            isId(row.id) &&
            CustomerValidator
                .validate(
                    row.name,
                    row.phone,
                    row.note,
                    row.tag,
                    row.smsConsent,
                    row.smsConsentAt?.let(Instant::parse),
                    source,
                ).isEmpty() &&
            row.name == row.name.trim() &&
            instant(row.createdAt) &&
            instant(row.updatedAt) &&
            optional(row.deletedAt, ::instant)
    }

    private fun validEntry(row: BackupEntry): Boolean = validAmount(row) && validReferences(row) && validText(row)

    private fun validAmount(row: BackupEntry): Boolean =
        EntryType.entries.any { it.name == row.type } &&
            row.amountMinor in Limits.AMOUNT_MIN..Limits.AMOUNT_MAX &&
            row.currency == CURRENCY &&
            date(row.occurredOn) &&
            optional(row.dueOn, ::date) &&
            instant(row.createdAt)

    private fun validReferences(row: BackupEntry): Boolean =
        isId(row.id) &&
            isId(row.customerId) &&
            optional(row.reverses, ::isId) &&
            optional(row.reversedBy, ::isId)

    private fun validText(row: BackupEntry): Boolean =
        optional(row.note) { it.length <= Limits.NOTE_MAX } &&
            optional(row.photoKey) { it.isNotBlank() && it.length <= PHOTO_KEY_MAX } &&
            optional(row.createdBy) { it.length <= CREATED_BY_MAX }

    private fun optional(
        value: String?,
        check: (String) -> Boolean,
    ): Boolean = value == null || check(value)

    private fun uniqueIds(snapshot: BackupSnapshot): Boolean =
        snapshot.customers
            .map { it.id }
            .toSet()
            .size == snapshot.customers.size &&
            snapshot.entries
                .map { it.id }
                .toSet()
                .size == snapshot.entries.size

    /** Every entry names a customer of the file; a correction and its original point at each other. */
    private fun linksHold(snapshot: BackupSnapshot): Boolean {
        val customers = snapshot.customers.map { it.id }.toSet()
        val entries = snapshot.entries.associateBy { it.id }
        return snapshot.entries.all { row ->
            row.customerId in customers &&
                reversesHold(row, row.reverses?.let(entries::get)) &&
                (row.reversedBy == null || entries[row.reversedBy]?.reverses == row.id)
        }
    }

    private fun reversesHold(
        row: BackupEntry,
        original: BackupEntry?,
    ): Boolean {
        if (row.reverses == null) return true
        return original != null &&
            original.reversedBy == row.id &&
            original.reverses == null &&
            row.reversedBy == null &&
            original.customerId == row.customerId &&
            original.type == row.type &&
            original.amountMinor == row.amountMinor
    }

    private fun isId(value: String): Boolean =
        try {
            UUID.fromString(value).toString() == value.lowercase(Locale.ROOT) && value.length == UUID_LENGTH
        } catch (ignored: IllegalArgumentException) {
            false
        }

    private fun instant(value: String): Boolean =
        try {
            Instant.parse(value)
            true
        } catch (ignored: DateTimeParseException) {
            false
        }

    private fun date(value: String): Boolean =
        try {
            LocalDate.parse(value)
            true
        } catch (ignored: DateTimeParseException) {
            false
        }

    private const val SHOP_ID_MAX = 64
    private const val CURRENCY = "TRY"
    private const val UUID_LENGTH = 36
    private const val PHOTO_KEY_MAX = 512
    private const val CREATED_BY_MAX = 64
}
