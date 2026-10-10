package app.cetele.android.feature.shop.create

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.component.ButtonStyle
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.feature.shop.R
import app.cetele.android.feature.shop.ShopContent
import app.cetele.android.feature.shop.ShopForm
import app.cetele.android.feature.shop.ShopFormFields
import app.cetele.android.feature.shop.ShopFormState

@Composable
fun CreateShopScreen(
    state: ShopFormState,
    onChange: (ShopForm) -> Unit,
    onSubmit: () -> Unit,
    onJoin: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ShopContent(stringResource(R.string.shop_create_title), onBack, modifier) {
        ShopFormFields(state, onChange)
        CeteleButton(stringResource(R.string.shop_create_submit), onSubmit, loading = state.busy)
        CeteleButton(
            stringResource(R.string.shop_switcher_join),
            onJoin,
            style = ButtonStyle.Text,
            enabled = !state.busy,
        )
    }
}
