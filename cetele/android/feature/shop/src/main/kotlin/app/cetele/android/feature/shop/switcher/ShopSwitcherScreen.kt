package app.cetele.android.feature.shop.switcher

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.component.ButtonStyle
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.designsystem.component.NavRow
import app.cetele.android.core.designsystem.component.Sheet
import app.cetele.android.core.designsystem.component.SheetRule
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.feature.shop.R
import app.cetele.android.feature.shop.ShopContent
import app.cetele.android.feature.shop.ShopFailureText

@Composable
fun ShopSwitcherScreen(
    state: ShopSwitcherState,
    onSelect: (String) -> Unit,
    onCreate: () -> Unit,
    onJoin: () -> Unit,
    onRefresh: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ShopContent(stringResource(R.string.shop_switcher_title), onBack, modifier) {
        ShopFailureText(state.failure)
        if (state.shops.isNotEmpty()) {
            Sheet(inset = false) {
                state.shops.forEachIndexed { index, shop ->
                    if (index > 0) SheetRule(Modifier.padding(start = CeteleSpacing.regular))
                    val owner = shop.role == ShopRole.OWNER
                    val role = stringResource(if (owner) R.string.shop_members_owner else R.string.shop_members_staff)
                    val active = shop.id == state.activeId
                    NavRow(
                        shop.name,
                        { onSelect(shop.id) },
                        supporting = if (active) role + "\n" + stringResource(R.string.shop_switcher_active) else role,
                        enabled = !state.busy,
                    )
                }
            }
        }
        CeteleButton(
            stringResource(R.string.shop_switcher_create),
            onCreate,
            modifier = Modifier.fillMaxWidth(),
            enabled = !state.busy,
        )
        CeteleButton(
            stringResource(R.string.shop_switcher_join),
            onJoin,
            style = ButtonStyle.Text,
            enabled = !state.busy,
        )
        CeteleButton(
            stringResource(R.string.shop_common_refresh),
            onRefresh,
            style = ButtonStyle.Text,
            loading = state.busy,
        )
    }
}
