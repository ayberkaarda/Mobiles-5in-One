package app.cetele.android.feature.export.pdf

import android.graphics.Canvas
import android.graphics.pdf.PdfDocument
import java.io.OutputStream

/** Page sink used by the statement writer; the default implementation wraps the platform PDF document. */
interface PdfPages {
    val pageCount: Int

    fun startPage(
        number: Int,
        width: Int,
        height: Int,
    ): Canvas

    fun finishPage()

    fun writeTo(out: OutputStream)

    fun close()
}

internal class AndroidPdfPages : PdfPages {
    private val document = PdfDocument()
    private var current: PdfDocument.Page? = null

    override val pageCount: Int get() = document.pages.size

    override fun startPage(
        number: Int,
        width: Int,
        height: Int,
    ): Canvas {
        val page = document.startPage(PdfDocument.PageInfo.Builder(width, height, number).create())
        current = page
        return page.canvas
    }

    override fun finishPage() {
        current?.let(document::finishPage)
        current = null
    }

    override fun writeTo(out: OutputStream) = document.writeTo(out)

    override fun close() = document.close()
}
