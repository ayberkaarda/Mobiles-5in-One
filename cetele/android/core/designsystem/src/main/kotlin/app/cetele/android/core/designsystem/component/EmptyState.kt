package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme

/** An empty page that says what to do next. */
@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    text: String,
    modifier: Modifier = Modifier,
    action: (@Composable () -> Unit)? = null,
) {
    val colors = CeteleTheme.colors
    Column(
        modifier =
            modifier.fillMaxWidth().padding(
                horizontal = CeteleSpacing.spacious,
                vertical = CeteleSpacing.wide,
            ),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(CeteleSpacing.medium),
    ) {
        Box(
            Modifier.size(CeteleSpacing.iconBadge).clip(CircleShape).background(colors.surface),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = colors.textMuted)
        }
        Text(
            title,
            modifier = Modifier.semantics { heading() },
            style = CeteleTextStyles.title,
            color = colors.text,
            textAlign = TextAlign.Center,
        )
        Text(text, style = CeteleTextStyles.body, color = colors.textMuted, textAlign = TextAlign.Center)
        action?.invoke()
    }
}
