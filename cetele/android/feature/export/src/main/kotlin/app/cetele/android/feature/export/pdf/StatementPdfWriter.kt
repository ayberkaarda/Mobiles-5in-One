package app.cetele.android.feature.export.pdf

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import app.cetele.android.core.domain.format.DateFormats
import app.cetele.android.core.domain.format.MoneyFormat
import app.cetele.android.core.domain.ledger.StatementRow
import app.cetele.android.core.domain.model.Customer
import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.feature.export.R
import app.cetele.android.feature.export.share.ExportFiles
import java.io.File
import java.time.LocalDate

class StatementPdfWriter(
    private val context: Context,
    private val files: ExportFiles,
    private val documents: () -> PdfPages = ::AndroidPdfPages,
) {
    internal var lastPageCount: Int = 0
        private set

    fun write(
        shop: Shop,
        customer: Customer,
        rows: List<StatementRow>,
        issuedOn: LocalDate,
        fonts: PdfFonts,
    ): File {
        require(customer.shopId == shop.id)
        require(rows.all { it.entry.shopId == shop.id && it.entry.customerId == customer.id })
        val file = files.pdf(shop.name, customer.name, issuedOn)
        var complete = false
        try {
            val document = documents()
            try {
                val pages = rows.chunked(ROWS_PER_PAGE).ifEmpty { listOf(emptyList()) }
                pages.forEachIndexed { index, pageRows ->
                    val canvas = document.startPage(index + 1, PAGE_WIDTH, PAGE_HEIGHT)
                    drawPage(
                        canvas,
                        shop,
                        customer,
                        pageRows,
                        rows.lastOrNull(),
                        issuedOn,
                        fonts,
                        index + 1,
                        pages.size,
                    )
                    document.finishPage()
                }
                lastPageCount = document.pageCount
                file.outputStream().use { document.writeTo(it) }
            } finally {
                document.close()
            }
            complete = true
            return file
        } finally {
            if (!complete) file.delete()
        }
    }

    @Suppress("LongParameterList")
    private fun drawPage(
        canvas: Canvas,
        shop: Shop,
        customer: Customer,
        rows: List<StatementRow>,
        last: StatementRow?,
        date: LocalDate,
        fonts: PdfFonts,
        number: Int,
        total: Int,
    ) {
        val body =
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                typeface = fonts.body
                textSize = BODY_SIZE
                color = Color.BLACK
                fontFeatureSettings = "tnum"
            }
        val heading =
            Paint(body).apply {
                typeface = fonts.heading
                textSize = HEADING_SIZE
            }
        canvas.drawText(fit(shop.name, heading, CONTENT_WIDTH), LEFT, TITLE_Y, heading)
        canvas.drawText(context.getString(R.string.export_statement_title), LEFT, CUSTOMER_Y, body)
        canvas.drawText(fit(customer.name, body, CONTENT_WIDTH), LEFT, NAME_Y, body)
        canvas.drawText(DateFormats.long(date), LEFT, DATE_Y, body)
        drawHeaders(canvas, body)
        rows.forEachIndexed { index, row -> drawRow(canvas, row, ROW_START + index * ROW_HEIGHT, body) }
        heading.textSize = BALANCE_SIZE
        canvas.drawText(context.getString(R.string.export_statement_balance), LEFT, BALANCE_Y, heading)
        drawAmount(canvas, MoneyFormat.format(last?.runningBalance?.minor ?: 0L), RIGHT, BALANCE_Y, body)
        val footer = context.getString(R.string.export_statement_footer, shop.name)
        drawFooter(canvas, footer, body)
        canvas.drawText(context.getString(R.string.export_statement_page, number, total), LEFT, PAGE_Y, body)
    }

    private fun drawHeaders(
        canvas: Canvas,
        paint: Paint,
    ) {
        canvas.drawText(context.getString(R.string.export_statement_date), LEFT, HEADER_Y, paint)
        canvas.drawText(context.getString(R.string.export_statement_description), DESCRIPTION_X, HEADER_Y, paint)
        drawAmount(canvas, context.getString(R.string.export_statement_debt), DEBT_X, HEADER_Y, paint)
        drawAmount(canvas, context.getString(R.string.export_statement_payment), PAYMENT_X, HEADER_Y, paint)
        drawAmount(canvas, context.getString(R.string.export_statement_balance_column), RIGHT, HEADER_Y, paint)
    }

    private fun drawRow(
        canvas: Canvas,
        row: StatementRow,
        y: Float,
        paint: Paint,
    ) {
        val entry = row.entry
        paint.isStrikeThruText = row.struck
        canvas.drawText(DateFormats.short(entry.occurredOn), LEFT, y, paint)
        val label =
            if (entry.type == EntryType.DEBT) R.string.export_statement_debt else R.string.export_statement_payment
        val description = entry.note?.takeIf { it.isNotBlank() } ?: context.getString(label)
        canvas.drawText(fit(description, paint, DESCRIPTION_WIDTH), DESCRIPTION_X, y, paint)
        val amountColumn = if (entry.type == EntryType.DEBT) DEBT_X else PAYMENT_X
        drawAmount(canvas, MoneyFormat.format(entry.amount.minor), amountColumn, y, paint)
        paint.isStrikeThruText = false
        drawAmount(canvas, MoneyFormat.format(row.runningBalance.minor), RIGHT, y, paint)
        if (row.struck || row.correctionOf != null) {
            val reference = row.correctionOf ?: entry.reversedBy.orEmpty()
            val correction = context.getString(R.string.export_statement_correction, reference)
            canvas.drawText(fit(correction, paint, DESCRIPTION_WIDTH), DESCRIPTION_X, y + CORRECTION_OFFSET, paint)
        }
    }

    private fun drawAmount(
        canvas: Canvas,
        value: String,
        x: Float,
        y: Float,
        paint: Paint,
    ) {
        canvas.drawText(value, x - paint.measureText(value), y, paint)
    }

    private fun drawFooter(
        canvas: Canvas,
        text: String,
        paint: Paint,
    ) {
        val clean = text.map { if (it.isISOControl()) ' ' else it }.joinToString("")
        val count = paint.breakText(clean, true, CONTENT_WIDTH, null)
        canvas.drawText(clean.take(count), LEFT, FOOTER_Y, paint)
        if (count < clean.length) {
            canvas.drawText(
                fit(clean.substring(count).trimStart(), paint, CONTENT_WIDTH),
                LEFT,
                FOOTER_Y + FOOTER_LINE_HEIGHT,
                paint,
            )
        }
    }

    private fun fit(
        text: String,
        paint: Paint,
        width: Float,
    ): String {
        val clean = text.map { if (it.isISOControl()) ' ' else it }.joinToString("")
        if (paint.measureText(clean) <= width) return clean
        val count = paint.breakText(clean, true, width - paint.measureText("…"), null)
        return clean.take(count) + "…"
    }

    companion object {
        const val ROWS_PER_PAGE = 32
        private const val PAGE_WIDTH = 595
        private const val PAGE_HEIGHT = 842
        private const val LEFT = 32f
        private const val RIGHT = 563f
        private const val CONTENT_WIDTH = RIGHT - LEFT
        private const val DESCRIPTION_X = 100f
        private const val DESCRIPTION_WIDTH = 174f
        private const val DEBT_X = 367f
        private const val PAYMENT_X = 465f
        private const val TITLE_Y = 48f
        private const val CUSTOMER_Y = 70f
        private const val NAME_Y = 88f
        private const val DATE_Y = 106f
        private const val HEADER_Y = 132f
        private const val ROW_START = 152f
        private const val ROW_HEIGHT = 18f
        private const val CORRECTION_OFFSET = 8f
        private const val BALANCE_Y = 754f
        private const val FOOTER_Y = 788f
        private const val FOOTER_LINE_HEIGHT = 10f
        private const val PAGE_Y = 810f
        private const val BODY_SIZE = 8f
        private const val HEADING_SIZE = 18f
        private const val BALANCE_SIZE = 12f
    }
}
