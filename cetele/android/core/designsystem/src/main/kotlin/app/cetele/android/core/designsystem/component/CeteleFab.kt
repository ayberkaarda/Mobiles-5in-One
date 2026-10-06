package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.layout.sizeIn
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTheme

@Composable
fun CeteleFab(
    text: String,
    icon: ImageVector,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ExtendedFloatingActionButton(
        text = { Text(text) },
        icon = { Icon(icon, contentDescription = null) },
        onClick = onClick,
        modifier = modifier.sizeIn(minWidth = CeteleSpacing.fabSize, minHeight = CeteleSpacing.fabSize),
        containerColor = CeteleTheme.colors.accent,
        contentColor = CeteleTheme.colors.onAccent,
    )
}
