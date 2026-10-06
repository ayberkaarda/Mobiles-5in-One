package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme

@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    text: String,
    modifier: Modifier = Modifier,
    action: (@Composable () -> Unit)? = null,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(CeteleSpacing.screenGutter),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(CeteleSpacing.regular),
    ) {
        Icon(icon, contentDescription = null, tint = CeteleTheme.colors.textMuted)
        SectionHeader(title)
        Text(text, style = CeteleTextStyles.body, color = CeteleTheme.colors.textMuted)
        action?.invoke()
    }
}
