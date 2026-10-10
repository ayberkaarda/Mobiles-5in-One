package app.cetele.android.feature.ledger.entry

import android.content.ActivityNotFoundException
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.cetele.android.feature.ledger.photo.PhotoCapture
import java.io.File
import java.io.IOException

@Composable
fun EntryEditRoute(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: EntryEditViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var capturePath by rememberSaveable { mutableStateOf<String?>(null) }
    val launcher =
        rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { captured ->
            capturePath?.let { path ->
                val file = File(path)
                if (captured) viewModel.compressCapture(file) else PhotoCapture.discard(file)
            }
            capturePath = null
        }
    LaunchedEffect(state.savedId) {
        if (state.savedId != null) onBack()
    }
    EntryEditScreen(
        state = state,
        modifier = modifier,
        actions =
            EntryEditActions(
                viewModel::setAmount,
                viewModel::setType,
                viewModel::setOccurredOn,
                viewModel::setDueOn,
                viewModel::setNote,
                onCapture = {
                    try {
                        val file = PhotoCapture.create(context)
                        capturePath = file.path
                        launcher.launch(PhotoCapture.uri(context, file))
                    } catch (_: ActivityNotFoundException) {
                        capturePath?.let { PhotoCapture.discard(File(it)) }
                        capturePath = null
                        viewModel.captureFailed()
                    } catch (_: IOException) {
                        viewModel.captureFailed()
                    } catch (_: IllegalArgumentException) {
                        capturePath?.let { PhotoCapture.discard(File(it)) }
                        capturePath = null
                        viewModel.captureFailed()
                    } catch (_: IllegalStateException) {
                        viewModel.captureFailed()
                    } catch (_: SecurityException) {
                        capturePath?.let { PhotoCapture.discard(File(it)) }
                        capturePath = null
                        viewModel.captureFailed()
                    }
                },
                onRemovePhoto = viewModel::removePhoto,
                onSave = viewModel::save,
                onBack = onBack,
            ),
    )
}
