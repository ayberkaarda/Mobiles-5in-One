package app.cetele.android.core.designsystem.component

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.R
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.domain.model.ShopPlan
import app.cetele.android.core.domain.model.ShopRole

/**
 * Follow-up of a `plan.*` or `sms.quota_exceeded` limit on the free plan: the owner gets the way to Çetele Pro,
 * staff are told that the owner can upgrade. Nothing is shown on Pro, where the limit is the Pro limit.
 */
@Composable
fun PlanUpgradeAction(
    shop: Shop?,
    onUpgrade: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    if (shop == null || shop.plan != ShopPlan.FREE) return
    when (shop.role) {
        ShopRole.OWNER -> {
            if (onUpgrade != null) {
                CeteleButton(
                    stringResource(R.string.designsystem_plan_upgrade),
                    onUpgrade,
                    modifier,
                    style = ButtonStyle.Text,
                )
            }
        }

        ShopRole.STAFF -> {
            Text(stringResource(R.string.designsystem_plan_owner_only), modifier)
        }
    }
}
