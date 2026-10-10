package app.cetele.android.feature.shop.join

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.designsystem.component.CeteleTextField
import app.cetele.android.feature.shop.R
import app.cetele.android.feature.shop.ShopContent
import app.cetele.android.feature.shop.ShopFailureText

@Composable
fun JoinShopScreen(
    state: JoinShopState,
    onChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ShopContent(stringResource(R.string.shop_join_title), onBack, modifier) {
        CeteleTextField(
            state.code,
            onChange,
            stringResource(R.string.shop_join_code),
            error = if (state.invalidCode) stringResource(R.string.shop_join_length) else null,
            enabled = !state.busy,
        )
        ShopFailureText(state.failure)
        CeteleButton(stringResource(R.string.shop_join_submit), onSubmit, loading = state.busy)
    }
}
