package app.cetele.server.statements

import org.apache.pdfbox.pdmodel.PDDocument
import org.apache.pdfbox.pdmodel.PDPage
import org.apache.pdfbox.pdmodel.PDPageContentStream
import org.apache.pdfbox.pdmodel.common.PDRectangle
import org.apache.pdfbox.pdmodel.font.PDType0Font
import org.springframework.core.io.ClassPathResource
import org.springframework.stereotype.Component
import java.io.ByteArrayOutputStream

@Component
class StatementPdf {
    fun render(data: StatementData): ByteArray =
        PDDocument().use { document ->
            val regular = font(document, "Inter-Regular.ttf")
            val strong = font(document, "Inter-SemiBold.ttf")
            val display = font(document, "Manrope-Bold.ttf")
            var stream: PDPageContentStream? = null
            var y = 0f

            fun text(
                value: String,
                x: Float,
                size: Float,
                face: PDType0Font = regular,
            ) {
                stream!!.beginText()
                stream!!.setFont(face, size)
                stream!!.newLineAtOffset(x, y)
                stream!!.showText(value)
                stream!!.endText()
            }

            fun page() {
                stream?.close()
                val page = PDPage(PDRectangle.A4)
                document.addPage(page)
                stream = PDPageContentStream(document, page)
                y = 790f
                text("Hesap Dökümü", 40f, 22f, display)
                y -= 30f
                for (line in wrap(data.shopName, strong, 12f, 510f) + wrap(data.customerName, regular, 12f, 510f)) {
                    text(line, 40f, 12f)
                    y -= 17f
                }
                text(data.date, 40f, 10f)
                y -= 26f
                listOf("Tarih", "Açıklama", "Borç", "Tahsilat", "Bakiye").zip(listOf(40f, 110f, 285f, 375f, 465f)).forEach { (label, x) ->
                    text(label, x, 10f, strong)
                }
                y -= 20f
            }
            try {
                page()
                for (row in data.rows) {
                    val lines = wrap(row.description, regular, 9f, 165f)
                    val height = maxOf(24f, lines.size * 13f + 8f)
                    if (y - height < 65f) page()
                    val top = y
                    text(row.date, 40f, 9f)
                    text(row.debt, 285f, 9f)
                    text(row.payment, 375f, 9f)
                    text(row.balance, 465f, 9f)
                    for (line in lines) {
                        if (y < 65f) page()
                        text(line, 110f, 9f)
                        if (row.reversed) {
                            stream!!.moveTo(110f, y + 3f)
                            stream!!.lineTo(110f + regular.getStringWidth(line) * 9f / 1000f, y + 3f)
                            stream!!.stroke()
                        }
                        y -= 13f
                    }
                    y = minOf(y - 8f, top - height)
                }
                if (y < 130f) page()
                y -= 15f
                text("Güncel bakiye: ${data.balance}", 40f, 12f, strong)
                y -= 30f
                for (line in wrap(data.footer, regular, 10f, 510f)) {
                    if (y < 40f) page()
                    text(line, 40f, 10f)
                    y -= 14f
                }
            } finally {
                stream?.close()
            }
            ByteArrayOutputStream().use { output ->
                document.save(output)
                output.toByteArray()
            }
        }

    private fun font(
        document: PDDocument,
        name: String,
    ): PDType0Font = ClassPathResource("static/assets/fonts/$name").inputStream.use { PDType0Font.load(document, it) }

    private fun wrap(
        value: String,
        font: PDType0Font,
        size: Float,
        width: Float,
    ): List<String> {
        val lines = mutableListOf<String>()
        var line = ""
        value.codePoints().forEach { point ->
            val character = String(Character.toChars(point))
            val printable = if (Character.isISOControl(point)) " " else character
            val safe =
                try {
                    font.encode(printable)
                    printable
                } catch (_: IllegalArgumentException) {
                    "?"
                }
            if (line.isNotEmpty() && font.getStringWidth(line + safe) * size / 1000f > width) {
                lines.add(line)
                line = ""
            }
            line += safe
        }
        lines.add(line)
        return lines
    }
}
