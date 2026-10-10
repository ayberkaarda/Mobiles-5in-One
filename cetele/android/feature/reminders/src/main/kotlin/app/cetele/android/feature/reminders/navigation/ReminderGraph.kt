package app.cetele.android.feature.reminders.navigation

import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import app.cetele.android.feature.reminders.sheet.ReminderSheetRoute

fun NavGraphBuilder.remindersGraph(nav: ReminderNavigation) {
    composable<ReminderRoutes.Sheet> {
        ReminderSheetRoute(viewModel = hiltViewModel(), onDismiss = nav::onBack)
    }
}
