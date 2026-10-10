package app.cetele.android.feature.shop.edit

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.designsystem.component.RoleGate
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.feature.shop.R
import app.cetele.android.feature.shop.ShopContent
import app.cetele.android.feature.shop.ShopForm
import app.cetele.android.feature.shop.ShopFormFields
import app.cetele.android.feature.shop.ShopFormState

@Composable
fun EditShopScreen(
    state: ShopFormState,
    role: ShopRole?,
    onChange: (ShopForm) -> Unit,
    onSubmit: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ShopContent(stringResource(R.string.shop_edit_title), onBack, modifier) {
        if (role == ShopRole.STAFF) Text(stringResource(R.string.shop_common_owner_only))
        RoleGate(role, ShopRole.OWNER) {
            ShopFormFields(state, onChange)
            CeteleButton(stringResource(R.string.shop_edit_submit), onSubmit, loading = state.busy)
        }
    }
}
