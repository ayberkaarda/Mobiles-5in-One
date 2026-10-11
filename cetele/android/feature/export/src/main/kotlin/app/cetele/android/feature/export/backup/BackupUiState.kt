package app.cetele.android.feature.export.backup

import app.cetele.android.core.data.backup.BackupMergeResult
import app.cetele.android.core.data.backup.BackupPreview
import app.cetele.android.core.data.backup.BackupProblem
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.feature.export.R
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream

/** Holds no passphrase: the fields keep it in composition only and hand it over per action. */
data class BackupUiState(
    val loading: Boolean = true,
    val shops: List<Shop> = emptyList(),
    val selectedShopId: String? = null,
    val busy: Boolean = false,
    val passphraseError: Int? = null,
    val errorRes: Int? = null,
    val exported: ExportedCounts? = null,
    val fileLoaded: Boolean = false,
    val preview: BackupPreview? = null,
    val imported: BackupMergeResult.Ok? = null,
)

data class ExportedCounts(
    val customers: Int,
    val entries: Int,
)

internal object BackupRules {
    const val PASSPHRASE_MIN = 10
    const val PASSPHRASE_MAX = 256
    const val MIME = "application/octet-stream"
    private const val CHUNK_BYTES = 64 * 1024

    fun passphraseError(
        passphrase: String,
        confirm: String,
    ): Int? =
        when {
            passphrase.length < PASSPHRASE_MIN -> R.string.export_backup_passphrase_short
            passphrase.length > PASSPHRASE_MAX -> R.string.export_backup_passphrase_long
            passphrase != confirm -> R.string.export_backup_passphrase_mismatch
            else -> null
        }

    fun problemText(problem: BackupProblem): Int =
        when (problem) {
            BackupProblem.NOT_A_BACKUP -> R.string.export_restore_not_backup
            BackupProblem.UNSUPPORTED_VERSION -> R.string.export_restore_version
            BackupProblem.MALFORMED -> R.string.export_restore_malformed
            BackupProblem.AUTHENTICATION -> R.string.export_restore_authentication
            BackupProblem.NOT_OWNER -> R.string.export_backup_owner_only
            BackupProblem.CONFLICT -> R.string.export_restore_conflict
        }

    /** Reads at most [limit] bytes; a longer stream is refused rather than cut. */
    fun readCapped(
        input: InputStream,
        limit: Int,
    ): ByteArray {
        val out = ByteArrayOutputStream()
        val chunk = ByteArray(CHUNK_BYTES)
        while (true) {
            val read = input.read(chunk)
            if (read < 0) break
            if (out.size() + read > limit) throw IOException("Backup file too large")
            out.write(chunk, 0, read)
        }
        return out.toByteArray()
    }
}
