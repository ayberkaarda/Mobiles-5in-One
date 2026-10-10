package app.cetele.android.feature.export

import java.io.File

data class ExportAttachment(
    val file: File,
    val mime: String,
)
