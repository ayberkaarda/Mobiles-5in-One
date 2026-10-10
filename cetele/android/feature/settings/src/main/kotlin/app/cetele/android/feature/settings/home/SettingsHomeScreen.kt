package app.cetele.android.feature.settings.home

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.data.settings.ThemeMode
import app.cetele.android.core.designsystem.component.ButtonStyle
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.designsystem.component.ConfirmSheet
import app.cetele.android.core.designsystem.component.RoleGate
import app.cetele.android.core.domain.format.DateFormats
import app.cetele.android.core.domain.model.ShopPlan
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.domain.time.CeteleClock
import app.cetele.android.feature.settings.R
import app.cetele.android.feature.settings.common.SettingsErrorText
import app.cetele.android.feature.settings.common.SettingsPage
import app.cetele.android.feature.settings.navigation.SettingsRoutes
import java.time.Instant

@Composable
@Suppress("LongMethod")
internal fun SettingsHomeScreen(
    state: SettingsHomeState,
    onOpen: (Any) -> Unit,
    onCancelDeletion: () -> Unit,
    onTheme: (ThemeMode) -> Unit,
    onSignOut: () -> Unit,
    onConfirmSignOut: () -> Unit,
    onDismissSignOut: () -> Unit,
) {
    SettingsPage(stringResource(R.string.settings_home_title)) {
        state.deletion?.let { deletion ->
            Text(
                stringResource(
                    R.string.settings_home_grace,
                    DateFormats.long(deletion.graceUntil.atZone(CeteleClock.ZONE).toLocalDate()),
                ),
            )
            if (deletion.blocked) Text(stringResource(R.string.settings_home_blocked))
            CeteleButton(
                stringResource(R.string.settings_home_cancel_deletion),
                onCancelDeletion,
                enabled = !state.busy,
            )
        }
        CeteleButton(stringResource(R.string.settings_home_profile), {
            onOpen(SettingsRoutes.Profile)
        }, style = ButtonStyle.Text)
        Text(stringResource(R.string.settings_home_shop))
        state.shop?.let { Text(it.name) }
        if (state.shop?.plan != ShopPlan.PRO) Text(stringResource(R.string.settings_home_plan))
        CeteleButton(
            stringResource(R.string.settings_home_lock),
            { onOpen(SettingsRoutes.Lock) },
            style = ButtonStyle.Text,
        )
        Text(stringResource(R.string.settings_home_pending, state.pending))
        state.lastSync?.let {
            Text(
                stringResource(
                    R.string.settings_home_last_sync,
                    DateFormats.long(Instant.parse(it).atZone(CeteleClock.ZONE).toLocalDate()),
                ),
            )
        }
        CeteleButton(stringResource(R.string.settings_home_sync), {
            onOpen(SettingsRoutes.SyncIssues)
        }, style = ButtonStyle.Text)
        Text(stringResource(R.string.settings_home_theme))
        ThemeMode.entries.forEach { mode ->
            val label =
                when (mode) {
                    ThemeMode.SYSTEM -> R.string.settings_home_theme_system
                    ThemeMode.LIGHT -> R.string.settings_home_theme_light
                    ThemeMode.DARK -> R.string.settings_home_theme_dark
                }
            CeteleButton(
                stringResource(label),
                { onTheme(mode) },
                enabled = mode != state.theme,
                style = ButtonStyle.Text,
            )
        }
        CeteleButton(
            stringResource(R.string.settings_home_about),
            { onOpen(SettingsRoutes.About) },
            style = ButtonStyle.Text,
        )
        RoleGate(state.shop?.role, ShopRole.OWNER) {
            CeteleButton(stringResource(R.string.settings_home_shop_deletion), {
                onOpen(SettingsRoutes.ShopDeletion)
            }, style = ButtonStyle.Text)
            CeteleButton(stringResource(R.string.settings_home_transfer), {
                onOpen(SettingsRoutes.OwnershipTransfer)
            }, style = ButtonStyle.Text)
        }
        CeteleButton(stringResource(R.string.settings_home_account_deletion), {
            onOpen(SettingsRoutes.AccountDeletion)
        }, style = ButtonStyle.Text)
        CeteleButton(
            stringResource(R.string.settings_home_sign_out),
            onSignOut,
            enabled = !state.busy,
            style = ButtonStyle.Text,
        )
        SettingsErrorText(state.error)
    }
    if (state.signOutConfirmation) {
        ConfirmSheet(
            title = stringResource(R.string.settings_home_sign_out),
            text =
                state.signOutPending?.let { stringResource(R.string.settings_home_unsent, it) }
                    ?: stringResource(R.string.settings_home_sign_out_confirm),
            confirmText = stringResource(R.string.settings_home_sign_out),
            destructive = true,
            onConfirm = onConfirmSignOut,
            onDismiss = onDismissSignOut,
            loading = state.busy,
        )
    }
}
