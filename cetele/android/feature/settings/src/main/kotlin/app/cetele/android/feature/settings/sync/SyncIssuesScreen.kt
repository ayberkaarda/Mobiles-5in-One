package app.cetele.android.feature.settings.sync

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.data.database.entity.OutboxEntity
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.designsystem.copy.ProblemCodeText
import app.cetele.android.feature.settings.R
import app.cetele.android.feature.settings.common.SettingsPage

@Composable
internal fun SyncIssuesScreen(
    issues: List<OutboxEntity>,
    onRemove: (OutboxEntity) -> Unit,
    onWithoutPhoto: (OutboxEntity) -> Unit,
    onBack: () -> Unit,
) {
    SettingsPage(stringResource(R.string.settings_home_sync), onBack) {
        if (issues.isEmpty()) Text(stringResource(R.string.settings_sync_empty))
        issues.forEach { row ->
            Text(row.entityId)
            Text(
                stringResource(
                    if (row.state ==
                        "REJECTED"
                    ) {
                        R.string.settings_sync_rejected
                    } else {
                        R.string.settings_sync_blocked
                    },
                ),
            )
            Text(
                stringResource(
                    if (row.lastCode ==
                        null
                    ) {
                        R.string.settings_sync_photo_wait
                    } else {
                        ProblemCodeText.resIdOrGeneric(row.lastCode)
                    },
                ),
            )
            if (canSendWithoutPhoto(row)) {
                CeteleButton(stringResource(R.string.settings_sync_without_photo), {
                    onWithoutPhoto(row)
                })
            }
            if (row.state == "REJECTED") CeteleButton(stringResource(R.string.settings_sync_remove), { onRemove(row) })
        }
    }
}
