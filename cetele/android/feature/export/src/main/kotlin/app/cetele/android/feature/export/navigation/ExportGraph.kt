package app.cetele.android.feature.export.navigation

import android.content.ActivityNotFoundException
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import app.cetele.android.feature.export.ExportAttachment
import app.cetele.android.feature.export.ExportStatementScreen
import app.cetele.android.feature.export.ExportViewModel
import app.cetele.android.feature.export.backup.BackupExportScreen
import app.cetele.android.feature.export.backup.BackupImportScreen
import app.cetele.android.feature.export.backup.BackupViewModel
import app.cetele.android.feature.export.share.ExportShare
import kotlinx.coroutines.flow.Flow

fun NavGraphBuilder.exportGraph(nav: ExportNavigation) {
    composable<ExportRoutes.Statement> { entry ->
        val route = entry.toRoute<ExportRoutes.Statement>()
        val model: ExportViewModel = hiltViewModel()
        LaunchedEffect(model, route.customerId) { model.openStatement(route.customerId) }
        ShareEffects(model.shares, model::sharingFailed)
        val snapshot by model.snapshot.collectAsStateWithLifecycle()
        val action by model.action.collectAsStateWithLifecycle()
        ExportStatementScreen(snapshot, action, model::share, model::download, nav::onBack)
    }
    composable<ExportRoutes.All> {
        val model: ExportViewModel = hiltViewModel()
        LaunchedEffect(model) { model.openAll() }
        ShareEffects(model.shares, model::sharingFailed)
        val snapshot by model.snapshot.collectAsStateWithLifecycle()
        val action by model.action.collectAsStateWithLifecycle()
        ExportAllScreen(snapshot, action, model::share, nav::onBack)
    }
    composable<ExportRoutes.Backup> {
        val model: BackupViewModel = hiltViewModel()
        ShareEffects(model.shares, model::sharingFailed)
        val state by model.state.collectAsStateWithLifecycle()
        BackupExportScreen(state, model::select, model::export, nav::onBack)
    }
    composable<ExportRoutes.Restore> {
        val model: BackupViewModel = hiltViewModel()
        val picker =
            rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
                uri?.let(model::fileSelected)
            }
        val state by model.state.collectAsStateWithLifecycle()
        BackupImportScreen(
            state,
            onPick = { picker.launch(arrayOf("application/octet-stream", "*/*")) },
            onOpen = model::open,
            onConfirm = model::confirmImport,
            onCancel = model::cancelImport,
            onBack = nav::onBack,
        )
    }
}

@Composable
private fun ShareEffects(
    shares: Flow<ExportAttachment>,
    onFailure: () -> Unit,
) {
    val context = LocalContext.current
    LaunchedEffect(shares, context) {
        shares.collect { attachment ->
            try {
                ExportShare.share(context, attachment.file, attachment.mime)
            } catch (ignored: ActivityNotFoundException) {
                onFailure()
            }
        }
    }
}
