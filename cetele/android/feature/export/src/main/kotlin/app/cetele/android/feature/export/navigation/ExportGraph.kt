package app.cetele.android.feature.export.navigation

import android.content.ActivityNotFoundException
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import androidx.navigation.toRoute
import app.cetele.android.feature.export.ExportAllScreen
import app.cetele.android.feature.export.ExportStatementScreen
import app.cetele.android.feature.export.ExportViewModel
import app.cetele.android.feature.export.share.ExportShare

fun NavGraphBuilder.exportGraph(nav: ExportNavigation) {
    composable<ExportRoutes.Statement> { entry ->
        val route = entry.toRoute<ExportRoutes.Statement>()
        val model: ExportViewModel = hiltViewModel()
        LaunchedEffect(model, route.customerId) { model.openStatement(route.customerId) }
        ShareEffects(model)
        val snapshot by model.snapshot.collectAsStateWithLifecycle()
        val action by model.action.collectAsStateWithLifecycle()
        ExportStatementScreen(snapshot, action, model::share, model::download, nav::onBack)
    }
    composable<ExportRoutes.All> {
        val model: ExportViewModel = hiltViewModel()
        LaunchedEffect(model) { model.openAll() }
        ShareEffects(model)
        val snapshot by model.snapshot.collectAsStateWithLifecycle()
        val action by model.action.collectAsStateWithLifecycle()
        ExportAllScreen(snapshot, action, model::share, nav::onBack)
    }
}

@Composable
private fun ShareEffects(model: ExportViewModel) {
    val context = LocalContext.current
    LaunchedEffect(model, context) {
        model.shares.collect { attachment ->
            try {
                ExportShare.share(context, attachment.file, attachment.mime)
            } catch (ignored: ActivityNotFoundException) {
                model.sharingFailed()
            }
        }
    }
}
