@file:Suppress("MatchingDeclarationName")

package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.designsystem.R

/** Presentation state; callers map their sync store state into these four display values. */
@Immutable
data class SyncStatusSummary(
    val pendingCount: Int = 0,
    val blockedCount: Int = 0,
    val rejectedCount: Int = 0,
    val offline: Boolean = false,
) {
    init {
        require(pendingCount >= 0 && blockedCount >= 0 && rejectedCount >= 0) { "Counts must be non-negative" }
    }
}

@Composable
fun SyncStatusChip(
    status: SyncStatusSummary,
    modifier: Modifier = Modifier,
) {
    val issues = status.blockedCount.toLong() + status.rejectedCount
    val text =
        when {
            status.offline -> stringResource(R.string.offline_banner)
            issues > 0 -> stringResource(R.string.designsystem_sync_issues, issues)
            status.pendingCount > 0 -> stringResource(R.string.designsystem_sync_pending, status.pendingCount)
            else -> stringResource(R.string.designsystem_sync_done)
        }
    Surface(
        modifier = modifier.semantics { liveRegion = LiveRegionMode.Polite },
        shape = MaterialTheme.shapes.small,
        color = CeteleTheme.colors.surfaceSunken,
        contentColor = if (issues > 0) CeteleTheme.colors.errorText else CeteleTheme.colors.textMuted,
    ) {
        Text(text, modifier = Modifier.padding(CeteleSpacing.medium), style = CeteleTextStyles.caption)
    }
}
