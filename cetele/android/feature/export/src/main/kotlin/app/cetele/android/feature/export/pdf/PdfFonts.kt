package app.cetele.android.feature.export.pdf

import android.content.Context
import android.content.res.Resources
import android.graphics.Typeface
import androidx.core.content.res.ResourcesCompat
import app.cetele.android.core.designsystem.R

data class PdfFonts(
    val body: Typeface,
    val heading: Typeface,
) {
    companion object {
        fun load(context: Context): PdfFonts =
            try {
                PdfFonts(
                    ResourcesCompat.getFont(context, R.font.inter_regular) ?: throw FontUnavailableException(),
                    ResourcesCompat.getFont(context, R.font.manrope_bold) ?: throw FontUnavailableException(),
                )
            } catch (error: Resources.NotFoundException) {
                throw FontUnavailableException(error)
            }
    }
}
