package app.cetele.android.feature.settings.home

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import app.cetele.android.core.data.settings.ThemeMode
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.designsystem.component.ConfirmSheet
import app.cetele.android.core.designsystem.component.InfoRow
import app.cetele.android.core.designsystem.component.NavRow
import app.cetele.android.core.designsystem.component.RoleGate
import app.cetele.android.core.designsystem.component.Sheet
import app.cetele.android.core.designsystem.component.SheetRule
import app.cetele.android.core.domain.format.DateFormats
import app.cetele.android.core.domain.model.Shop
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
    onOpenBilling: (() -> Unit)? = null,
) {
    SettingsPage(stringResource(R.string.settings_home_title), sheets = true) {
        state.deletion?.let { deletion ->
            Sheet {
                InfoRow(
                    stringResource(
                        R.string.settings_home_grace,
                        DateFormats.long(deletion.graceUntil.atZone(CeteleClock.ZONE).toLocalDate()),
                    ),
                    supporting = if (deletion.blocked) stringResource(R.string.settings_home_blocked) else null,
                )
                CeteleButton(
                    stringResource(R.string.settings_home_cancel_deletion),
                    onCancelDeletion,
                    modifier =
                        Modifier.padding(
                            start = CeteleSpacing.regular,
                            end = CeteleSpacing.regular,
                            bottom = CeteleSpacing.regular,
                        ),
                    enabled = !state.busy,
                )
            }
        }
        Sheet {
            NavRow(stringResource(R.string.settings_home_profile), { onOpen(SettingsRoutes.Profile) })
            SheetRule(Modifier.padding(start = CeteleSpacing.regular))
            NavRow(stringResource(R.string.settings_devices_title), { onOpen(SettingsRoutes.Devices) })
        }
        GroupLabel(stringResource(R.string.settings_home_shop))
        ShopSheet(state.shop, onOpenBilling)
        Sheet {
            NavRow(stringResource(R.string.settings_home_lock), { onOpen(SettingsRoutes.Lock) })
            SheetRule(Modifier.padding(start = CeteleSpacing.regular))
            NavRow(
                stringResource(R.string.settings_home_sync),
                { onOpen(SettingsRoutes.SyncIssues) },
                supporting = syncLine(state),
            )
        }
        GroupLabel(stringResource(R.string.settings_home_theme))
        Sheet {
            ThemeMode.entries.forEachIndexed { index, mode ->
                val label =
                    when (mode) {
                        ThemeMode.SYSTEM -> R.string.settings_home_theme_system
                        ThemeMode.LIGHT -> R.string.settings_home_theme_light
                        ThemeMode.DARK -> R.string.settings_home_theme_dark
                    }
                if (index > 0) SheetRule(Modifier.padding(start = CeteleSpacing.regular))
                NavRow(
                    stringResource(label),
                    { onTheme(mode) },
                    enabled = mode != state.theme,
                    selected = mode == state.theme,
                )
            }
        }
        Sheet { NavRow(stringResource(R.string.settings_home_about), { onOpen(SettingsRoutes.About) }) }
        Sheet {
            RoleGate(state.shop?.role, ShopRole.OWNER) {
                NavRow(
                    stringResource(R.string.settings_home_shop_deletion),
                    { onOpen(SettingsRoutes.ShopDeletion) },
                    destructive = true,
                )
                SheetRule(Modifier.padding(start = CeteleSpacing.regular))
                NavRow(stringResource(R.string.settings_home_transfer), { onOpen(SettingsRoutes.OwnershipTransfer) })
                SheetRule(Modifier.padding(start = CeteleSpacing.regular))
            }
            NavRow(
                stringResource(R.string.settings_home_account_deletion),
                { onOpen(SettingsRoutes.AccountDeletion) },
                destructive = true,
            )
            SheetRule(Modifier.padding(start = CeteleSpacing.regular))
            NavRow(stringResource(R.string.settings_home_sign_out), onSignOut, enabled = !state.busy)
        }
        Box(Modifier.padding(horizontal = CeteleSpacing.screenGutter)) { SettingsErrorText(state.error) }
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

/** The active shop, the free plan's limits and the way to the plan and Çetele Pro screen. */
@Composable
private fun ShopSheet(
    shop: Shop?,
    onOpenBilling: (() -> Unit)?,
) {
    Sheet {
        val plan = if (shop?.plan != ShopPlan.PRO) stringResource(R.string.settings_home_plan) else null
        if (shop != null) {
            InfoRow(shop.name, supporting = plan)
        } else if (plan != null) {
            InfoRow(plan)
        }
        if (shop != null && onOpenBilling != null) {
            SheetRule(Modifier.padding(start = CeteleSpacing.regular))
            NavRow(stringResource(R.string.settings_home_billing), onOpenBilling)
        }
    }
}

/** Records waiting to be sent, and the last sync day when there is one. */
@Composable
private fun syncLine(state: SettingsHomeState): String {
    val pending = stringResource(R.string.settings_home_pending, state.pending)
    val last =
        state.lastSync?.let {
            stringResource(
                R.string.settings_home_last_sync,
                DateFormats.long(Instant.parse(it).atZone(CeteleClock.ZONE).toLocalDate()),
            )
        }
    return if (last == null) pending else pending + "\n" + last
}

/** A quiet label above a group of rows. */
@Composable
private fun GroupLabel(text: String) {
    Text(
        text,
        modifier =
            Modifier
                .padding(
                    start = CeteleSpacing.spacious,
                    end = CeteleSpacing.spacious,
                    top = CeteleSpacing.small,
                ).semantics { heading() },
        style = CeteleTextStyles.bodyStrong,
        color = CeteleTheme.colors.textMuted,
    )
}
