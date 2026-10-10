package app.cetele.android.feature.ledger.entry

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.designsystem.copy.FieldErrorText
import app.cetele.android.core.designsystem.copy.ProblemCodeText
import app.cetele.android.core.domain.validation.FieldError

@Composable
internal fun EntryErrors(
    errors: List<FieldError>,
    modifier: Modifier = Modifier,
) {
    errors.forEach { error ->
        Text(
            text = stringResource(ProblemCodeText.resId(error.code) ?: FieldErrorText.resId(error)),
            modifier = modifier,
            style = CeteleTextStyles.body,
            color = CeteleTheme.colors.error,
        )
    }
}
