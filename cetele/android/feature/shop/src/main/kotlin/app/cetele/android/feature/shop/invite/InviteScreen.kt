package app.cetele.android.feature.shop.invite

import android.content.Intent
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.designsystem.component.CeteleTextField
import app.cetele.android.core.designsystem.component.RoleGate
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.feature.shop.R
import app.cetele.android.feature.shop.ShopContent
import app.cetele.android.feature.shop.ShopFailureText

@Composable
fun InviteScreen(
    state: InviteState,
    onChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val chooserTitle = stringResource(R.string.shop_invite_share)
    val shareText = state.invitation?.let { stringResource(R.string.shop_invite_message, it.code) }
    ShopContent(stringResource(R.string.shop_invite_title), onBack, modifier) {
        if (state.role == ShopRole.STAFF) Text(stringResource(R.string.shop_common_owner_only))
        RoleGate(state.role, ShopRole.OWNER) {
            ShopFailureText(state.failure)
            val invitation = state.invitation
            if (invitation == null) {
                CeteleTextField(
                    state.phone,
                    onChange,
                    stringResource(R.string.shop_invite_phone),
                    error = if (state.invalidPhone) stringResource(R.string.shop_invite_invalid_phone) else null,
                    keyboard = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    enabled = !state.busy,
                )
                CeteleButton(stringResource(R.string.shop_invite_submit), onSubmit, loading = state.busy)
            } else {
                Text(stringResource(R.string.shop_invite_once))
                Text(invitation.code)
                Text(stringResource(R.string.shop_invite_validity))
                CeteleButton(chooserTitle, {
                    val intent = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, shareText)
                    context.startActivity(Intent.createChooser(intent, chooserTitle))
                })
            }
        }
    }
}
