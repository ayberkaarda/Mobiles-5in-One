package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import app.cetele.android.core.designsystem.CeteleIcons
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.designsystem.R

/**
 * Top bar on the page background (no band of its own). A top-level screen (no [onBack]) gets the larger
 * headline; a pushed screen gets the title size so a long customer name still fits next to its actions.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CeteleTopBar(
    title: String,
    modifier: Modifier = Modifier,
    onBack: (() -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    val colors = CeteleTheme.colors
    TopAppBar(
        title = {
            Text(
                title,
                style = if (onBack == null) CeteleTextStyles.headline else CeteleTextStyles.title,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        },
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
        colors =
            TopAppBarDefaults.topAppBarColors(
                containerColor = colors.background,
                scrolledContainerColor = colors.background,
                titleContentColor = colors.text,
                navigationIconContentColor = colors.text,
                actionIconContentColor = colors.primaryText,
            ),
    )
}
