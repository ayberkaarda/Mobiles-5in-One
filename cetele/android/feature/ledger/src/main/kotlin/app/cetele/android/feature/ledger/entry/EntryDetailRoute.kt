package app.cetele.android.feature.ledger.entry

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.cetele.android.feature.ledger.R
import app.cetele.android.feature.ledger.photo.EntryPhoto

@Composable
fun EntryDetailRoute(
    onBack: () -> Unit,
    onEntrySelected: (String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: EntryDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var unavailable by remember(state.entry?.id, state.photoStatus) { mutableStateOf(false) }
    EntryDetailScreen(
        state = state,
        actions =
            EntryDetailActions(
                onBack,
                onEntrySelected,
                viewModel::requestReversal,
                viewModel::confirmReversal,
                viewModel::dismissReversal,
            ),
        modifier = modifier,
        photoContent = { entry ->
            EntryPhoto(entry, viewModel.photoRepository, onUnavailable = { unavailable = true })
            if (unavailable) Text(stringResource(R.string.ledger_photo_view_error))
        },
    )
}
