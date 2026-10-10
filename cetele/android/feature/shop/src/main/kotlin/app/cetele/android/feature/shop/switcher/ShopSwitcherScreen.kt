package app.cetele.android.feature.shop.switcher

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.component.ButtonStyle
import app.cetele.android.core.designsystem.component.CeteleButton
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
        for (shop in state.shops) {
            CeteleButton(shop.name, { onSelect(shop.id) }, style = ButtonStyle.Outlined, enabled = !state.busy)
            if (shop.id == state.activeId) Text(stringResource(R.string.shop_switcher_active))
            Text(
                stringResource(
                    if (shop.role ==
                        app.cetele.android.core.domain.model.ShopRole.OWNER
                    ) {
                        R.string.shop_members_owner
                    } else {
                        R.string.shop_members_staff
                    },
                ),
            )
        }
        CeteleButton(stringResource(R.string.shop_switcher_create), onCreate, enabled = !state.busy)
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
