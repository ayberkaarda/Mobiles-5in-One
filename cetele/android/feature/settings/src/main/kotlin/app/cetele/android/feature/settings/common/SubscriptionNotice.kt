package app.cetele.android.feature.settings.common

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.component.ButtonStyle
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.feature.settings.R

/**
 * Deletion does not cancel a Play subscription and the server cannot cancel it (spec item 21): the owner is told
 * so and gets the way to Play's subscription page.
 */
@Composable
internal fun SubscriptionNotice(onManageSubscription: (() -> Unit)?) {
    if (onManageSubscription == null) return
    Text(stringResource(R.string.settings_deletion_subscription))
    CeteleButton(
        stringResource(R.string.settings_deletion_manage_subscription),
        onManageSubscription,
        style = ButtonStyle.Text,
    )
}
