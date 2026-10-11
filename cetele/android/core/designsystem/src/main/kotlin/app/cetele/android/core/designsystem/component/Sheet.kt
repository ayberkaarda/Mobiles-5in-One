package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CornerSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import app.cetele.android.core.designsystem.CeteleIcons
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme

/**
 * A sheet of ledger paper: rows grouped on one Kâğıt surface with hairline rules between them, set on the
 * stone background. Use [Sheet] for a fixed group and [SheetItem] for rows of a lazy list.
 */
@Composable
fun Sheet(
    modifier: Modifier = Modifier,
    inset: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .padding(horizontal = if (inset) CeteleSpacing.screenGutter else CeteleSpacing.none)
                .clip(MaterialTheme.shapes.medium)
                .background(CeteleTheme.colors.surface),
        content = content,
    )
}

/** One row of a sheet inside a lazy list; [index] and [count] decide the rounded ends and the rule above. */
@Composable
fun SheetItem(
    index: Int,
    count: Int,
    modifier: Modifier = Modifier,
    ruleInset: Dp = CeteleSpacing.screenGutter,
    content: @Composable () -> Unit,
) {
    Box(
        modifier
            .fillMaxWidth()
            .padding(horizontal = CeteleSpacing.screenGutter)
            .clip(sheetShape(index, count))
            .background(CeteleTheme.colors.surface),
    ) {
        content()
        if (index > 0) SheetRule(Modifier.padding(start = ruleInset).align(Alignment.TopStart))
    }
}

/** The hairline between two rows of a sheet. */
@Composable
fun SheetRule(modifier: Modifier = Modifier) {
    HorizontalDivider(modifier, thickness = CeteleSpacing.hairline, color = CeteleTheme.colors.border)
}

@Composable
private fun sheetShape(
    index: Int,
    count: Int,
): Shape {
    val radius = (MaterialTheme.shapes.medium as RoundedCornerShape).topStart
    val none = CornerSize(CeteleSpacing.none)
    val top = if (index == 0) radius else none
    val bottom = if (index == count - 1) radius else none
    return RoundedCornerShape(top, top, bottom, bottom)
}

/** A row that opens another screen: label, optional supporting line and a chevron. */
@Composable
fun NavRow(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    supporting: String? = null,
    destructive: Boolean = false,
    enabled: Boolean = true,
    selected: Boolean? = null,
) {
    val colors = CeteleTheme.colors
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .heightIn(min = CeteleSpacing.navRowHeight)
                .then(if (selected != null) Modifier.semantics { this.selected = selected } else Modifier)
                .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
                .padding(horizontal = CeteleSpacing.regular, vertical = CeteleSpacing.medium),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(CeteleSpacing.medium),
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                label,
                style = CeteleTextStyles.bodyStrong,
                color =
                    when {
                        destructive -> colors.errorText
                        else -> colors.text
                    },
            )
            if (supporting != null) {
                Text(supporting, style = CeteleTextStyles.body, color = colors.textMuted)
            }
        }
        when (selected) {
            true -> Icon(CeteleIcons.check, contentDescription = null, tint = colors.primaryText)
            false -> Unit
            null -> Icon(CeteleIcons.chevron, contentDescription = null, tint = colors.textMuted)
        }
    }
}

/** A plain line of information inside a sheet (no action). */
@Composable
fun InfoRow(
    text: String,
    modifier: Modifier = Modifier,
    supporting: String? = null,
) {
    Column(
        modifier
            .fillMaxWidth()
            .heightIn(min = CeteleSpacing.navRowHeight)
            .padding(horizontal = CeteleSpacing.regular, vertical = CeteleSpacing.medium),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(text, style = CeteleTextStyles.bodyStrong, color = CeteleTheme.colors.text)
        if (supporting != null) {
            Text(supporting, style = CeteleTextStyles.body, color = CeteleTheme.colors.textMuted)
        }
    }
}

/** A quiet label on sunken paper, for states like "Düzeltme" or "Düzeltilmiş kayıt". */
@Composable
fun Tag(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = CeteleTheme.colors.textMuted,
) {
    Surface(modifier = modifier, shape = MaterialTheme.shapes.extraSmall, color = CeteleTheme.colors.surfaceSunken) {
        Text(
            text,
            modifier = Modifier.padding(horizontal = CeteleSpacing.small),
            style = CeteleTextStyles.caption,
            color = color,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** Initials of a customer on a quiet squircle; decorative, the name next to it is what is read out. */
@Composable
fun CustomerAvatar(
    name: String,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .size(CeteleSpacing.avatar)
            .clip(MaterialTheme.shapes.small)
            .background(CeteleTheme.colors.secondary)
            .clearAndSetSemantics {},
        contentAlignment = Alignment.Center,
    ) {
        Text(monogram(name), style = CeteleTextStyles.bodyStrong, color = CeteleTheme.colors.onSecondary)
    }
}

/** First letters of the first and last word, skipping bracketed prefixes such as a sample marker. */
fun monogram(name: String): String {
    val words =
        name
            .replace(bracketed, " ")
            .split(' ', '\t', '\n')
            .filter { word -> word.firstOrNull()?.isLetterOrDigit() == true }
    return when {
        words.isEmpty() -> name.trim().take(1)
        words.size == 1 -> words.first().take(1)
        else -> "${words.first().first()}${words.last().first()}"
    }
}

private val bracketed = Regex("\\[[^\\]]*\\]|\\([^)]*\\)")
