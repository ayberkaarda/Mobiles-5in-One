package app.cetele.android.core.designsystem

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/**
 * Icon set. The line icons share one grid (24 dp), one stroke (1.75) and round caps so the tab bar, rows
 * and buttons read as one family; they are drawn in black and tinted by `Icon`.
 */
object CeteleIcons {
    val back = Icons.AutoMirrored.Filled.ArrowBack
    val add = Icons.Filled.Add
    val check = Icons.Filled.Check
    val close = Icons.Filled.Close
    val info = Icons.Filled.Info
    val warning = Icons.Filled.Warning
    val debt = R.drawable.ic_debt
    val payment = R.drawable.ic_payment
    val whatsapp = R.drawable.ic_whatsapp

    /** Today tab: a tally of four notches crossed by the fifth. */
    val today: ImageVector = line("today", "M6 5V19M10 5V19M14 5V19M18 5V19M3.5 16.5L20.5 7.5")

    /** Customers tab: two people. */
    val customers: ImageVector =
        line(
            "customers",
            "M9 11.25A3.25 3.25 0 1 0 9 4.75A3.25 3.25 0 1 0 9 11.25Z" +
                "M3 19.5C3 16.4 5.7 14.25 9 14.25C12.3 14.25 15 16.4 15 19.5" +
                "M16 11A2.5 2.5 0 1 0 16 6A2.5 2.5 0 1 0 16 11Z" +
                "M16.5 14.3C19.1 14.6 21 16.6 21 19.5",
        )

    /** Shop tab: a storefront with an awning. */
    val shop: ImageVector =
        line(
            "shop",
            "M4 9L5.5 4.75H18.5L20 9" +
                "M4 9A2.67 2.67 0 0 0 9.33 9A2.67 2.67 0 0 0 14.67 9A2.67 2.67 0 0 0 20 9" +
                "M5.5 12V19.5H18.5V12M10 19.5V15H14V19.5",
        )

    /** Settings tab: three sliders. */
    val settings: ImageVector =
        line(
            "settings",
            "M4 7H7M11 7H20M9 9A2 2 0 1 0 9 5A2 2 0 1 0 9 9Z" +
                "M4 12H13M17 12H20M15 14A2 2 0 1 0 15 10A2 2 0 1 0 15 14Z" +
                "M4 17H6M10 17H20M8 19A2 2 0 1 0 8 15A2 2 0 1 0 8 19Z",
        )

    val search: ImageVector = line("search", "M10.5 16.5A6 6 0 1 0 10.5 4.5A6 6 0 1 0 10.5 16.5ZM15 15L20 20")

    val chevron: ImageVector = line("chevron", "M9.5 6L15.5 12L9.5 18", autoMirror = true)

    val remind: ImageVector =
        line("remind", "M6 16.5V11A6 6 0 0 1 18 11V16.5L19.5 18H4.5L6 16.5ZM10 20.5A2 2 0 0 0 14 20.5")

    val statement: ImageVector =
        line("statement", "M7 3.5H14L18.5 8V20.5H7V3.5ZM14 3.5V8H18.5M9.75 12.5H15.75M9.75 16H15.75")

    val backspace: ImageVector =
        line("backspace", "M9 5.5H20V18.5H9L3.5 12L9 5.5ZM12.5 9.5L17 14M17 9.5L12.5 14", autoMirror = true)

    private const val GRID = 24f
    private const val STROKE = 1.75f

    private fun line(
        name: String,
        pathData: String,
        autoMirror: Boolean = false,
    ): ImageVector =
        ImageVector
            .Builder(
                name = "cetele.$name",
                defaultWidth = GRID.dp,
                defaultHeight = GRID.dp,
                viewportWidth = GRID,
                viewportHeight = GRID,
                autoMirror = autoMirror,
            ).addPath(
                pathData = PathParser().parsePathString(pathData).toNodes(),
                stroke = SolidColor(Color.Black),
                strokeLineWidth = STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            ).build()
}

/**
 * The Çetele mark (`cetele/brand/logo/cetele-mark.svg`): the Ç with four notches in [ink] and the cedilla,
 * the fifth notch, in [cedilla].
 */
fun cetelePaintedMark(
    ink: Color,
    cedilla: Color,
): ImageVector {
    val parser = PathParser()
    return ImageVector
        .Builder(
            name = "cetele.mark",
            defaultWidth = MARK_WIDTH.dp,
            defaultHeight = MARK_HEIGHT.dp,
            viewportWidth = MARK_WIDTH,
            viewportHeight = MARK_HEIGHT,
        ).addPath(
            pathData = parser.parsePathString("M40.25 14.2A18.9 18.9 0 1 0 40.25 40.46").toNodes(),
            stroke = SolidColor(ink),
            strokeLineWidth = MARK_ARC,
            strokeLineCap = StrokeCap.Round,
        ).addPath(
            pathData =
                PathParser()
                    .parsePathString("M19.18 18.98V35.68M24.45 18.98V35.68M29.73 18.98V35.68M35 18.98V35.68")
                    .toNodes(),
            stroke = SolidColor(ink),
            strokeLineWidth = MARK_NOTCH,
            strokeLineCap = StrokeCap.Round,
        ).addPath(
            pathData =
                PathParser()
                    .parsePathString(
                        "M26.65 49.53C26.65 50.98 26.65 52.1 26.65 53.13C26.65 54.16 27.77 54.24 27.77 55.36" +
                            "C27.77 56.73 26.48 57.25 24.08 57.07",
                    ).toNodes(),
            stroke = SolidColor(cedilla),
            strokeLineWidth = MARK_NOTCH,
            strokeLineCap = StrokeCap.Round,
        ).build()
}

private const val MARK_WIDTH = 48f
private const val MARK_HEIGHT = 64f
private const val MARK_ARC = 6.59f
private const val MARK_NOTCH = 3.52f
