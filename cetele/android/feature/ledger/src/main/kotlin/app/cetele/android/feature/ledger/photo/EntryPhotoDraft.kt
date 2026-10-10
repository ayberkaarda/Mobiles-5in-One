package app.cetele.android.feature.ledger.photo

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.dimensionResource
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.component.ButtonStyle
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.feature.ledger.R
import app.cetele.android.feature.ledger.entry.EntryEditState
import coil3.compose.AsyncImage

@Composable
internal fun EntryPhotoDraft(
    state: EntryEditState,
    onCapture: () -> Unit,
    onRemove: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val enabled = !state.busy && !state.photoBusy
    Column(modifier = modifier) {
        state.photo?.let { photo ->
            AsyncImage(
                model = photo.bytes,
                contentDescription = stringResource(R.string.ledger_photo_description),
                modifier = Modifier.fillMaxWidth().height(dimensionResource(R.dimen.ledger_photo_draft_height)),
            )
            CeteleButton(
                stringResource(R.string.ledger_photo_remove),
                onRemove,
                style = ButtonStyle.Text,
                enabled = enabled,
            )
        }
        CeteleButton(
            stringResource(R.string.ledger_photo_capture),
            onCapture,
            style = ButtonStyle.Outlined,
            enabled = enabled,
            loading = state.photoBusy,
        )
        if (state.photoFailed) Text(stringResource(R.string.ledger_photo_capture_error))
    }
}
