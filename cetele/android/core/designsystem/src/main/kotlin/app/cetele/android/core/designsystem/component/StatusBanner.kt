@file:Suppress("MatchingDeclarationName")

package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import app.cetele.android.core.designsystem.CeteleIcons
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.designsystem.R
import app.cetele.android.core.designsystem.copy.ProblemCodeText

enum class BannerKind {
    Info,
    Warning,
    Error,
    Offline,
}

@Composable
fun StatusBanner(
    kind: BannerKind,
    text: String,
    modifier: Modifier = Modifier,
    action: (@Composable () -> Unit)? = null,
) {
    val colors = CeteleTheme.colors
    val foreground =
        when (kind) {
            BannerKind.Error -> colors.errorText
            BannerKind.Warning -> colors.accentText
            BannerKind.Info, BannerKind.Offline -> colors.text
        }
    Surface(
        modifier = modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
        color = colors.surfaceSunken,
        contentColor = foreground,
    ) {
        Column(
            modifier = Modifier.padding(CeteleSpacing.screenGutter),
            verticalArrangement = Arrangement.spacedBy(CeteleSpacing.small),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(CeteleSpacing.small)) {
                Icon(
                    imageVector =
                        if (kind == BannerKind.Error || kind == BannerKind.Warning) {
                            CeteleIcons.warning
                        } else {
                            CeteleIcons.info
                        },
                    contentDescription = null,
                )
                Text(text, style = CeteleTextStyles.body, modifier = Modifier.weight(1f))
            }
            action?.invoke()
        }
    }
}

@Composable
fun ProblemBanner(
    code: String?,
    modifier: Modifier = Modifier,
    traceId: String? = null,
) {
    val known = ProblemCodeText.resId(code)
    StatusBanner(
        kind = BannerKind.Error,
        text = stringResource(known ?: R.string.error_generic),
        modifier = modifier,
        action =
            if (known == null && traceId != null && traceId.isNotBlank()) {
                {
                    Text(
                        stringResource(R.string.designsystem_error_support_code, traceId),
                        style = CeteleTextStyles.caption,
                    )
                }
            } else {
                null
            },
    )
}
