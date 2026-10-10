package app.cetele.android.feature.ledger.photo

import android.content.Context
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File

internal object PhotoCapture {
    fun create(context: Context): File {
        val directory = File(context.cacheDir, "captures")
        check(directory.isDirectory || directory.mkdirs()) { "Capture directory is unavailable" }
        return File.createTempFile("receipt-", ".jpg", directory)
    }

    fun uri(
        context: Context,
        file: File,
    ): Uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)

    fun discard(file: File) {
        check(file.delete() || !file.exists()) { "Capture could not be removed" }
    }
}
