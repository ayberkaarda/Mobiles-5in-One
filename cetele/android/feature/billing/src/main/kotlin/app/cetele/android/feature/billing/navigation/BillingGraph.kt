package app.cetele.android.feature.billing.navigation

import androidx.activity.compose.LocalActivity
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalUriHandler
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import app.cetele.android.feature.billing.BillingProduct
import app.cetele.android.feature.billing.ui.BillingActions
import app.cetele.android.feature.billing.ui.BillingScreen
import app.cetele.android.feature.billing.ui.BillingViewModel
import kotlinx.serialization.Serializable

object BillingRoutes {
    /** Plan, limits and the Çetele Pro offers of the active shop. */
    @Serializable data object Home
}

/** What the app provides to the billing screen. */
interface BillingNavigation {
    fun onBack()
}

fun NavGraphBuilder.billingGraph(nav: BillingNavigation) {
    composable<BillingRoutes.Home> {
        val model = hiltViewModel<BillingViewModel>()
        val state by model.state.collectAsStateWithLifecycle()
        val activity = LocalActivity.current
        val uriHandler = LocalUriHandler.current
        BillingScreen(
            state,
            BillingActions(
                onSubscribe = { offer -> activity?.let { model.subscribe(it, offer) } },
                onRestore = { model.restore() },
                onManage = { runCatching { uriHandler.openUri(BillingProduct.MANAGE_URL) } },
                onReload = { model.refresh() },
                onDismissNotice = model::dismissNotice,
                onBack = nav::onBack,
            ),
        )
    }
}
