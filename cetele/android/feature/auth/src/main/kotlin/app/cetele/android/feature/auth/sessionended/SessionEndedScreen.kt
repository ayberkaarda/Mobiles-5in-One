package app.cetele.android.feature.auth.sessionended

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.data.session.SignOutReason
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.feature.auth.R
import app.cetele.android.feature.auth.common.AuthPage

@Composable
fun SessionEndedScreen(
    reason: SignOutReason,
    onSignIn: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val resource =
        when (reason) {
            SignOutReason.USER -> R.string.auth_sessionended_user
            SignOutReason.REFRESH_INVALID -> R.string.auth_sessionended_expired
            SignOutReason.ACCOUNT_DELETED -> R.string.auth_sessionended_deleted
            SignOutReason.MEMBERSHIP_LOST -> R.string.auth_sessionended_membership
        }
    AuthPage(stringResource(R.string.auth_sessionended_title), modifier) {
        Text(stringResource(resource))
        CeteleButton(stringResource(R.string.auth_sessionended_signin), onSignIn)
    }
}
