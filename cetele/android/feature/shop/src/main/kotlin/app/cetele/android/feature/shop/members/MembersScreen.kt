package app.cetele.android.feature.shop.members

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.component.ButtonStyle
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.designsystem.component.ConfirmSheet
import app.cetele.android.core.designsystem.component.RoleGate
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.network.dto.shops.MemberView
import app.cetele.android.feature.shop.R
import app.cetele.android.feature.shop.ShopContent
import app.cetele.android.feature.shop.ShopFailureText

@Composable
fun MembersScreen(
    state: MembersState,
    onInvite: () -> Unit,
    onRemove: (MemberView) -> Unit,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    onRefresh: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ShopContent(stringResource(R.string.shop_members_title), onBack, modifier) {
        ShopFailureText(state.failure)
        if (state.role == ShopRole.STAFF) Text(stringResource(R.string.shop_common_owner_only))
        RoleGate(state.role, ShopRole.OWNER) {
            CeteleButton(stringResource(R.string.shop_members_invite), onInvite, enabled = !state.busy)
            CeteleButton(
                stringResource(R.string.shop_common_refresh),
                onRefresh,
                style = ButtonStyle.Text,
                loading = state.busy,
            )
            if (!state.busy && state.members.isEmpty()) Text(stringResource(R.string.shop_members_empty))
            for (member in state.members) {
                Text(member.displayName ?: member.phone)
                Text(member.phone)
                Text(
                    stringResource(
                        if (member.role ==
                            app.cetele.android.core.network.dto.ShopRole.OWNER
                        ) {
                            R.string.shop_members_owner
                        } else {
                            R.string.shop_members_staff
                        },
                    ),
                )
                CeteleButton(stringResource(R.string.shop_members_remove), {
                    onRemove(member)
                }, style = ButtonStyle.Text, enabled = !state.busy)
            }
        }
    }
    RoleGate(state.role, ShopRole.OWNER) {
        state.removal?.let {
            ConfirmSheet(
                stringResource(R.string.shop_members_remove),
                stringResource(R.string.shop_members_confirm),
                stringResource(R.string.shop_members_remove),
                true,
                onConfirm,
                onDismiss,
                loading = state.busy,
            )
        }
    }
}
