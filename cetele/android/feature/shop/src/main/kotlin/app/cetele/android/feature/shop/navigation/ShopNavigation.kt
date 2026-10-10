package app.cetele.android.feature.shop.navigation

import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import app.cetele.android.feature.shop.create.CreateShopScreen
import app.cetele.android.feature.shop.create.CreateShopViewModel
import app.cetele.android.feature.shop.edit.EditShopScreen
import app.cetele.android.feature.shop.edit.EditShopViewModel
import app.cetele.android.feature.shop.invite.InviteScreen
import app.cetele.android.feature.shop.invite.InviteViewModel
import app.cetele.android.feature.shop.join.JoinShopScreen
import app.cetele.android.feature.shop.join.JoinShopViewModel
import app.cetele.android.feature.shop.members.MembersScreen
import app.cetele.android.feature.shop.members.MembersViewModel
import app.cetele.android.feature.shop.switcher.ShopSwitcherScreen
import app.cetele.android.feature.shop.switcher.ShopSwitcherViewModel

interface ShopNavigation {
    fun onBack()

    fun onCreate()

    fun onJoin()

    fun onInvite()

    fun onShopSelected(shopId: String)

    fun onShopEdited()
}

fun NavGraphBuilder.shopGraph(nav: ShopNavigation) {
    composable<ShopRoutes.Create> {
        val model = hiltViewModel<CreateShopViewModel>()
        val state by model.state.collectAsStateWithLifecycle()
        LaunchedEffect(state.completedShopId) { state.completedShopId?.let(nav::onShopSelected) }
        CreateShopScreen(state, model::change, model::submit, nav::onJoin, nav::onBack)
    }
    composable<ShopRoutes.Join> {
        val model = hiltViewModel<JoinShopViewModel>()
        val state by model.state.collectAsStateWithLifecycle()
        LaunchedEffect(state.completedShopId) { state.completedShopId?.let(nav::onShopSelected) }
        JoinShopScreen(state, model::change, model::submit, nav::onBack)
    }
    composable<ShopRoutes.Members> {
        val model = hiltViewModel<MembersViewModel>()
        val state by model.state.collectAsStateWithLifecycle()
        MembersScreen(
            state,
            nav::onInvite,
            model::requestRemoval,
            model::remove,
            model::dismissRemoval,
            model::refresh,
            nav::onBack,
        )
    }
    composable<ShopRoutes.Invite> {
        val model = hiltViewModel<InviteViewModel>()
        val state by model.state.collectAsStateWithLifecycle()
        DisposableEffect(model) {
            onDispose { model.leaveScreen() }
        }
        InviteScreen(state, model::change, model::submit, nav::onBack)
    }
    composable<ShopRoutes.Edit> {
        val model = hiltViewModel<EditShopViewModel>()
        val state by model.state.collectAsStateWithLifecycle()
        val role by model.role.collectAsStateWithLifecycle()
        LaunchedEffect(state.completedShopId) { if (state.completedShopId != null) nav.onShopEdited() }
        EditShopScreen(state, role, model::change, model::submit, nav::onBack)
    }
    composable<ShopRoutes.Switcher> {
        val model = hiltViewModel<ShopSwitcherViewModel>()
        val state by model.state.collectAsStateWithLifecycle()
        LaunchedEffect(state.selectedId) { state.selectedId?.let(nav::onShopSelected) }
        ShopSwitcherScreen(state, model::select, nav::onCreate, nav::onJoin, model::refresh, nav::onBack)
    }
}
