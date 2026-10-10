package app.cetele.android.feature.customers.navigation

import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import androidx.navigation.toRoute
import app.cetele.android.core.designsystem.component.SyncStatusSummary
import app.cetele.android.feature.customers.detail.CustomerDetailScreen
import app.cetele.android.feature.customers.detail.CustomerDetailViewModel
import app.cetele.android.feature.customers.edit.CustomerEditScreen
import app.cetele.android.feature.customers.edit.CustomerEditViewModel
import app.cetele.android.feature.customers.edit.CustomerTextField
import app.cetele.android.feature.customers.list.CustomerListScreen
import app.cetele.android.feature.customers.list.CustomerListViewModel

fun NavGraphBuilder.customersGraph(nav: CustomerNavigation) {
    composable<CustomerRoutes.List> {
        val model = hiltViewModel<CustomerListViewModel>()
        val state by model.state.collectAsStateWithLifecycle()
        val sync by nav.syncStatus.collectAsStateWithLifecycle(SyncStatusSummary())
        val limited by nav.customerLimitRejected.collectAsStateWithLifecycle(false)
        CustomerListScreen(
            state,
            model::search,
            nav::onCustomerSelected,
            nav::onAddCustomer,
            syncStatus = sync,
            customerLimitRejected = limited,
        )
    }
    composable<CustomerRoutes.Edit> {
        val model = hiltViewModel<CustomerEditViewModel>()
        val state by model.state.collectAsStateWithLifecycle()
        LaunchedEffect(state.savedId) { state.savedId?.let(nav::onCustomerSaved) }
        CustomerEditScreen(
            state,
            { model.changeText(CustomerTextField.Name, it) },
            { model.changeText(CustomerTextField.Phone, it) },
            { model.changeText(CustomerTextField.Note, it) },
            { model.changeText(CustomerTextField.Tag, it) },
            model::changeConsent,
            model::changeSource,
            model::changeDate,
            model::save,
            nav::onBack,
        )
    }
    composable<CustomerRoutes.Detail> { entry ->
        val id = entry.toRoute<CustomerRoutes.Detail>().customerId
        val model = hiltViewModel<CustomerDetailViewModel>()
        val state by model.state.collectAsStateWithLifecycle()
        LaunchedEffect(state.deleted) { if (state.deleted) nav.onCustomerDeleted() }
        CustomerDetailScreen(
            state,
            { nav.onAddEntry(id, it) },
            nav::onEntrySelected,
            { nav.onRemind(id) },
            { nav.onExport(id) },
            { nav.onEditCustomer(id) },
            model::delete,
            nav::onBack,
        )
    }
}
