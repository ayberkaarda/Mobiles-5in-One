package app.cetele.android.feature.settings.sync

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.data.repository.PhotoUploadState
import app.cetele.android.core.data.repository.SyncIssue
import app.cetele.android.core.data.repository.SyncIssueState
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.designsystem.copy.ProblemCodeText
import app.cetele.android.feature.settings.R
import app.cetele.android.feature.settings.common.SettingsPage

@Composable
internal fun SyncIssuesScreen(
    issues: List<SyncIssue>,
    onRemove: (SyncIssue) -> Unit,
    onWithoutPhoto: (SyncIssue) -> Unit,
    onBack: () -> Unit,
) {
    SettingsPage(stringResource(R.string.settings_home_sync), onBack) {
        if (issues.isEmpty()) Text(stringResource(R.string.settings_sync_empty))
        issues.forEach { issue ->
            Text(issue.entityId)
            Text(
                stringResource(
                    if (issue.state == SyncIssueState.REJECTED) {
                        R.string.settings_sync_rejected
                    } else {
                        R.string.settings_sync_blocked
                    },
                ),
            )
            Text(stringResource(reasonText(issue)))
            if (issue.canSendWithoutPhoto) {
                CeteleButton(stringResource(R.string.settings_sync_without_photo), { onWithoutPhoto(issue) })
            }
            if (issue.canDismiss) CeteleButton(stringResource(R.string.settings_sync_remove), { onRemove(issue) })
        }
    }
}

/** Known problem codes win; otherwise a failed upload or a wait for the photo or a related record. */
internal fun reasonText(issue: SyncIssue): Int {
    val known = ProblemCodeText.resId(issue.code)
    val photoLost = issue.photo is PhotoUploadState.Failed || issue.photo == PhotoUploadState.Absent
    return when {
        known != null -> known
        photoLost -> R.string.settings_sync_photo_failed
        issue.code == null -> R.string.settings_sync_photo_wait
        else -> ProblemCodeText.resIdOrGeneric(issue.code)
    }
}
