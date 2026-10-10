package app.cetele.android.core.designsystem.component

import androidx.compose.runtime.Composable
import app.cetele.android.core.domain.model.ShopRole

@Composable
fun RoleGate(
    role: ShopRole?,
    requires: ShopRole,
    content: @Composable () -> Unit,
) {
    if (role != null && (role == ShopRole.OWNER || requires == ShopRole.STAFF)) content()
}
