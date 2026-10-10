package app.cetele.android.shop

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import app.cetele.android.R
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.component.ButtonStyle
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.designsystem.component.CeteleTopBar
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.feature.export.navigation.ExportRoutes
import app.cetele.android.feature.shop.navigation.ShopRoutes
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.serialization.Serializable
import javax.inject.Inject

/** Shell tab that groups the shop screens of the shop and export features. */
@Serializable
data object ShopHomeRoute

/** One entry of the shop tab; owner-only entries stay hidden for staff (the target screens check again). */
enum class ShopHomeAction(
    val route: Any,
    @param:StringRes val label: Int,
    val ownerOnly: Boolean,
) {
    SWITCH(ShopRoutes.Switcher, R.string.app_shop_switch, ownerOnly = false),
    DETAILS(ShopRoutes.Edit, R.string.app_shop_details, ownerOnly = false),
    MEMBERS(ShopRoutes.Members, R.string.app_shop_members, ownerOnly = true),
    EXPORT_ALL(ExportRoutes.All, R.string.app_shop_export_all, ownerOnly = true),
}

/** Actions shown for [role]; without an active shop only switching is possible. */
fun shopHomeActions(role: ShopRole?): List<ShopHomeAction> =
    when (role) {
        null -> listOf(ShopHomeAction.SWITCH)
        ShopRole.OWNER -> ShopHomeAction.entries
        ShopRole.STAFF -> ShopHomeAction.entries.filterNot(ShopHomeAction::ownerOnly)
    }

@HiltViewModel
class ShopHomeViewModel
    @Inject
    constructor(
        shops: ShopRepository,
    ) : ViewModel() {
        val shop: StateFlow<Shop?> = shops.observeActive().stateIn(viewModelScope, SharingStarted.Eagerly, null)
    }

@Composable
fun ShopHomeRoute(
    onOpen: (Any) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: ShopHomeViewModel = hiltViewModel(),
) {
    val shop by viewModel.shop.collectAsStateWithLifecycle()
    ShopHomeScreen(shop, onOpen, modifier)
}

@Composable
fun ShopHomeScreen(
    shop: Shop?,
    onOpen: (Any) -> Unit,
    modifier: Modifier = Modifier,
) {
    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = { CeteleTopBar(shop?.name ?: stringResource(R.string.app_shop_title)) },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = CeteleSpacing.screenGutter),
        ) {
            shopHomeActions(shop?.role).forEach { action ->
                CeteleButton(stringResource(action.label), { onOpen(action.route) }, style = ButtonStyle.Text)
            }
        }
    }
}
