package app.cetele.android.core.data.backup

import java.time.Instant

enum class BackupProblem {
    NOT_A_BACKUP,
    UNSUPPORTED_VERSION,
    MALFORMED,
    AUTHENTICATION,

    /** The shop is missing on this device or the signed-in user is not its owner. */
    NOT_OWNER,

    /** An id in the file already belongs to another shop, or a correction link disagrees with this device. */
    CONFLICT,
}

sealed interface BackupExportResult {
    data class Ok(
        val bytes: ByteArray,
        val shopName: String,
        val customers: Int,
        val entries: Int,
    ) : BackupExportResult {
        override fun equals(other: Any?): Boolean =
            other is Ok && bytes.contentEquals(other.bytes) && shopName == other.shopName &&
                customers == other.customers && entries == other.entries

        override fun hashCode(): Int = bytes.contentHashCode()
    }

    data class Failed(
        val problem: BackupProblem,
    ) : BackupExportResult
}

/** A decrypted and validated file, ready to show before the owner confirms the merge. */
data class BackupPreview(
    val snapshot: BackupSnapshot,
    val newCustomers: Int,
    val newEntries: Int,
) {
    val shopId: String get() = snapshot.shopId
    val shopName: String get() = snapshot.shopName
    val exportedAt: Instant get() = Instant.parse(snapshot.exportedAt)
    val customers: Int get() = snapshot.customers.size
    val entries: Int get() = snapshot.entries.size
}

sealed interface BackupOpenResult {
    data class Ok(
        val preview: BackupPreview,
    ) : BackupOpenResult

    data class Failed(
        val problem: BackupProblem,
    ) : BackupOpenResult
}

sealed interface BackupMergeResult {
    data class Ok(
        val addedCustomers: Int,
        val addedEntries: Int,
    ) : BackupMergeResult

    data class Failed(
        val problem: BackupProblem,
    ) : BackupMergeResult
}
