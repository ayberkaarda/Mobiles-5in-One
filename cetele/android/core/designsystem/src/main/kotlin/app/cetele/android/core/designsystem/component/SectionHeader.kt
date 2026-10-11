package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme

/** A section title on the page, aligned with the sheets under it; [trailing] holds a count or a link. */
@Composable
fun SectionHeader(
    text: String,
    modifier: Modifier = Modifier,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier =
            modifier.fillMaxWidth().padding(
                start = CeteleSpacing.screenGutter,
                end = CeteleSpacing.screenGutter,
                top = CeteleSpacing.extraLarge,
                bottom = CeteleSpacing.small,
            ),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = text,
            modifier = Modifier.weight(1f).semantics { heading() },
            style = CeteleTextStyles.title,
            color = CeteleTheme.colors.text,
        )
        trailing?.invoke()
    }
}
