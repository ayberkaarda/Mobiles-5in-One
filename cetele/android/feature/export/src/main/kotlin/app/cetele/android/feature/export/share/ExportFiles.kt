package app.cetele.android.feature.export.share

import java.io.File
import java.io.IOException
import java.text.Normalizer
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID

class ExportFiles(
    private val cacheDir: File,
) {
    private val directory: File get() = File(cacheDir, "exports")

    fun csv(
        shopName: String,
        date: LocalDate,
    ): File = destination("cetele-${slug(shopName)}-${stamp(date)}.csv")

    fun pdf(
        shopName: String,
        customerName: String,
        date: LocalDate,
    ): File = destination("cetele-${slug(shopName)}-${slug(customerName)}-${stamp(date)}.pdf")

    fun cleanup(nowMillis: Long = System.currentTimeMillis()): Int {
        var removed = 0
        directory
            .listFiles()
            ?.filter {
                it.isDirectory &&
                    !java.nio.file.Files
                        .isSymbolicLink(it.toPath())
            }?.forEach { folder ->
                folder
                    .listFiles()
                    ?.filter { it.isFile && it.lastModified() < nowMillis - RETENTION_MILLIS }
                    ?.forEach { if (it.delete()) removed++ }
                if (folder.listFiles()?.isEmpty() == true) folder.delete()
            }
        directory
            .listFiles()
            ?.filter { it.isFile && it.lastModified() < nowMillis - RETENTION_MILLIS }
            ?.forEach { if (it.delete()) removed++ }
        return removed
    }

    private fun destination(name: String): File {
        val folder = File(directory, UUID.randomUUID().toString())
        if (!folder.mkdirs() && !folder.isDirectory) throw IOException("Export directory unavailable")
        return File(folder, name)
    }

    private fun stamp(date: LocalDate): String = date.format(DateTimeFormatter.BASIC_ISO_DATE)

    companion object {
        const val RETENTION_MILLIS = 24L * 60 * 60 * 1000
        private const val SLUG_LIMIT = 60

        fun slug(name: String): String =
            Normalizer
                .normalize(name.lowercase(Locale.ROOT).replace('ı', 'i'), Normalizer.Form.NFD)
                .replace(Regex("\\p{M}+"), "")
                .replace(Regex("[^a-z0-9]+"), "-")
                .trim('-')
                .take(SLUG_LIMIT)
                .trimEnd('-')
                .ifEmpty { "dukkan" }
    }
}
