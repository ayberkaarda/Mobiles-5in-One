package app.cetele.android.feature.ledger.photo

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.dimensionResource
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.data.media.EncryptedPhotoFetcher
import app.cetele.android.core.data.media.PhotoRef
import app.cetele.android.core.data.media.PhotoRepository
import app.cetele.android.core.domain.model.LedgerEntry
import app.cetele.android.feature.ledger.R
import coil3.ImageLoader
import coil3.compose.AsyncImage

@Composable
internal fun EntryPhoto(
    entry: LedgerEntry,
    photos: PhotoRepository,
    onUnavailable: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val loader =
        remember(context, photos) {
            ImageLoader
                .Builder(context)
                .components { add(EncryptedPhotoFetcher.Factory(photos)) }
                .build()
        }
    var ready by remember(entry.id, entry.photoKey) { mutableStateOf(false) }
    LaunchedEffect(entry.id, entry.photoKey) {
        ready =
            if (entry.photoKey == null) {
                photos.open(entry.id) != null
            } else {
                photos.ensureCached(entry.shopId, entry).isSuccess
            }
        if (!ready) onUnavailable()
    }
    if (ready) {
        AsyncImage(
            model = PhotoRef(entry.id),
            imageLoader = loader,
            contentDescription = stringResource(R.string.ledger_photo_description),
            modifier = modifier.fillMaxWidth().height(dimensionResource(R.dimen.ledger_photo_height)),
            onError = { onUnavailable() },
        )
    }
}
