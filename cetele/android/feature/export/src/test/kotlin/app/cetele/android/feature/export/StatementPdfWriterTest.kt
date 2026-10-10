package app.cetele.android.feature.export

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.test.core.app.ApplicationProvider
import app.cetele.android.core.domain.ledger.StatementRows
import app.cetele.android.feature.export.pdf.PdfFonts
import app.cetele.android.feature.export.pdf.PdfPages
import app.cetele.android.feature.export.pdf.StatementPdfWriter
import app.cetele.android.feature.export.share.ExportFiles
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.IOException
import java.io.OutputStream

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class, qualifiers = "tr")
@GraphicsMode(GraphicsMode.Mode.LEGACY)
class StatementPdfWriterTest {
    private val context = ApplicationProvider.getApplicationContext<Application>()

    private class RecordingPages : PdfPages {
        val sizes = mutableListOf<Pair<Int, Int>>()
        var finished = 0
        var closed = false
        var written = false
        override val pageCount: Int get() = finished

        override fun startPage(
            number: Int,
            width: Int,
            height: Int,
        ): Canvas {
            sizes += width to height
            return Canvas(Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888))
        }

        override fun finishPage() {
            finished++
        }

        override fun writeTo(out: OutputStream) {
            written = true
            out.write("%PDF-".toByteArray(Charsets.US_ASCII))
        }

        override fun close() {
            closed = true
        }
    }

    private fun writer(pages: RecordingPages) = StatementPdfWriter(context, ExportFiles(context.cacheDir)) { pages }

    @Test
    fun writesOnePageForEmptyStatement() {
        val pages = RecordingPages()
        val writer = writer(pages)
        val file = writer.write(shop, customer, emptyList(), date, PdfFonts.load(context))
        assertTrue(file.isFile)
        assertEquals("%PDF-", file.inputStream().use { it.readNBytes(5).toString(Charsets.US_ASCII) })
        assertEquals(1, writer.lastPageCount)
        assertEquals(listOf(595 to 842), pages.sizes)
        assertTrue(pages.closed)
    }

    @Test
    fun pagesBreakAfterThirtyTwoRowsAndIncludeReversals() {
        listOf(1 to 1, 32 to 1, 33 to 2, 64 to 2, 65 to 3).forEach { (count, expected) ->
            val pages = RecordingPages()
            val writer = writer(pages)
            val rows =
                StatementRows.build(
                    (0 until count).map {
                        entry(
                            id = "entry-$it",
                            note = "<script> & \"süt\"",
                            reversedBy = if (it == 0) "correction" else null,
                        )
                    },
                )
            val file =
                writer.write(shop, customer.copy(name = "<script>Ayşe</script>"), rows, date, PdfFonts.load(context))
            assertTrue(file.length() > 0)
            assertEquals(expected, writer.lastPageCount)
            assertEquals(expected, pages.finished)
            assertTrue(pages.written)
            assertTrue(pages.closed)
            assertTrue(rows.first().struck)
        }
    }

    @Test
    fun failedWriteLeavesNoFileAndClosesDocument() {
        val pages =
            object : PdfPages {
                var closed = false
                override val pageCount: Int = 0

                override fun startPage(
                    number: Int,
                    width: Int,
                    height: Int,
                ) = Canvas(Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888))

                override fun finishPage() = Unit

                override fun writeTo(out: OutputStream) = throw IOException("disk full")

                override fun close() {
                    closed = true
                }
            }
        val writer = StatementPdfWriter(context, ExportFiles(context.cacheDir)) { pages }
        val result = runCatching { writer.write(shop, customer, emptyList(), date, PdfFonts.load(context)) }
        assertTrue(result.exceptionOrNull() is IOException)
        assertTrue(pages.closed)
        val leftovers =
            context.cacheDir
                .resolve("exports")
                .walkTopDown()
                .filter { it.isFile }
                .toList()
        assertTrue(leftovers.none { it.extension == "pdf" && it.length() == 0L })
    }

    @Test(expected = IllegalArgumentException::class)
    fun refusesRowsFromAnotherShop() {
        val rows = StatementRows.build(listOf(entry().copy(shopId = "another-shop")))
        writer(RecordingPages()).write(shop, customer, rows, date, PdfFonts.load(context))
    }
}
