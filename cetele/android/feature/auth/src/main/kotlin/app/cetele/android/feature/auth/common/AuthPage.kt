package app.cetele.android.feature.auth.common

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import app.cetele.android.core.designsystem.CeteleIcons
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.designsystem.component.BrandMark
import app.cetele.android.core.designsystem.isCompactHeight
import app.cetele.android.core.designsystem.R as DesignR

/**
 * The page of the sign-in and lock flow: the Çetele mark, a large title and the form under it, on the stone
 * background. A back arrow appears only when [onBack] is given.
 */
@Composable
fun AuthPage(
    title: String,
    modifier: Modifier = Modifier,
    onBack: (() -> Unit)? = null,
    centered: Boolean = false,
    subtitle: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = CeteleTheme.colors
    val alignment = if (centered) Alignment.CenterHorizontally else Alignment.Start
    val compact = isCompactHeight()
    val gap = if (compact) CeteleSpacing.small else CeteleSpacing.regular
    Scaffold(modifier = modifier, containerColor = colors.background) { insets ->
        BoxWithConstraints(Modifier.fillMaxSize().padding(insets)) {
            // A centred page (PIN entry) keeps its keypad at the bottom, within reach of the thumb.
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .heightIn(min = if (centered) maxHeight else CeteleSpacing.none)
                        .padding(horizontal = CeteleSpacing.extraLarge, vertical = CeteleSpacing.regular),
                verticalArrangement = if (centered) Arrangement.SpaceBetween else Arrangement.Top,
                horizontalAlignment = alignment,
            ) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(gap),
                    horizontalAlignment = alignment,
                ) {
                    if (onBack != null) {
                        IconButton(onClick = onBack) {
                            Icon(
                                CeteleIcons.back,
                                contentDescription = stringResource(DesignR.string.designsystem_navigation_back),
                            )
                        }
                    } else if (!compact) {
                        BrandMark(Modifier.padding(top = CeteleSpacing.small))
                    }
                    Text(
                        title,
                        modifier = Modifier.fillMaxWidth().semantics { heading() },
                        style = if (compact) CeteleTextStyles.headline else CeteleTextStyles.display,
                        color = colors.text,
                        textAlign = if (centered) TextAlign.Center else TextAlign.Start,
                    )
                    if (subtitle != null) {
                        Text(
                            subtitle,
                            modifier = Modifier.fillMaxWidth(),
                            style = CeteleTextStyles.body,
                            color = colors.textMuted,
                            textAlign = if (centered) TextAlign.Center else TextAlign.Start,
                        )
                    }
                }
                Column(
                    modifier = Modifier.padding(top = gap),
                    verticalArrangement = Arrangement.spacedBy(gap),
                    horizontalAlignment = alignment,
                    content = content,
                )
            }
        }
    }
}
