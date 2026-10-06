package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.CeteleIcons
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.R

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CeteleTopBar(
    title: String,
    modifier: Modifier = Modifier,
    onBack: (() -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    TopAppBar(
        title = { Text(title) },
        modifier = modifier,
        navigationIcon = {
            if (onBack != null) {
                IconButton(
                    onClick = onBack,
                    modifier =
                        Modifier.sizeIn(
                            minWidth = CeteleSpacing.touchTarget,
                            minHeight = CeteleSpacing.touchTarget,
                        ),
                ) {
                    Icon(CeteleIcons.back, contentDescription = stringResource(R.string.designsystem_navigation_back))
                }
            }
        },
        actions = actions,
    )
}
