package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.layout.sizeIn
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FloatingActionButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme

/** The one orange action of a screen; radius 16 (brand `radius.fab`) and one soft shadow. */
@Composable
fun CeteleFab(
    text: String,
    icon: ImageVector,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ExtendedFloatingActionButton(
        text = { Text(text, style = CeteleTextStyles.label) },
        icon = { Icon(icon, contentDescription = null) },
        onClick = onClick,
        modifier = modifier.sizeIn(minWidth = CeteleSpacing.fabSize, minHeight = CeteleSpacing.fabSize),
        shape = MaterialTheme.shapes.medium,
        containerColor = CeteleTheme.colors.accent,
        contentColor = CeteleTheme.colors.onAccent,
        elevation = FloatingActionButtonDefaults.elevation(defaultElevation = CeteleSpacing.extraSmall),
    )
}
