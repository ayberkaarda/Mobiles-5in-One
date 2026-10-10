package app.cetele.android.feature.export.share

import android.app.Activity
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import app.cetele.android.feature.export.R
import java.io.File

object ExportShare {
    fun intent(
        context: Context,
        file: File,
        mime: String,
    ): Intent {
        require(file.isFile)
        val root = File(context.cacheDir, "exports").canonicalFile
        require(file.canonicalFile.toPath().startsWith(root.toPath()))
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        return sendIntent(context, uri, file.name, mime)
    }

    internal fun sendIntent(
        context: Context,
        uri: Uri,
        name: String,
        mime: String,
    ): Intent =
        Intent(Intent.ACTION_SEND).apply {
            type = mime
            putExtra(Intent.EXTRA_STREAM, uri)
            clipData = ClipData.newUri(context.contentResolver, name, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

    fun share(
        context: Context,
        file: File,
        mime: String,
    ) {
        context.startActivity(chooser(context, intent(context, file, mime)))
    }

    internal fun chooser(
        context: Context,
        send: Intent,
    ): Intent {
        val chooser =
            Intent
                .createChooser(send, context.getString(R.string.export_common_share))
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        if (context !is Activity) chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return chooser
    }
}
