package app.cetele.android.feature.settings.common

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.component.CeteleTopBar
import app.cetele.android.core.designsystem.copy.ProblemCodeText
import app.cetele.android.feature.settings.R

@Composable
internal fun SettingsPage(
    title: String,
    onBack: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Scaffold(topBar = { CeteleTopBar(title, onBack = onBack) }) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(
                    padding,
                ).verticalScroll(rememberScrollState())
                .padding(CeteleSpacing.screenGutter),
            verticalArrangement = Arrangement.spacedBy(CeteleSpacing.regular),
            content = content,
        )
    }
}

@Composable
internal fun SettingsErrorText(error: SettingsError?) {
    if (error == null) return
    Text(
        stringResource(
            if (error.code == "auth.reauth_invalid") {
                R.string.settings_deletion_invalid_code
            } else {
                ProblemCodeText.resIdOrGeneric(error.code)
            },
        ),
        color = MaterialTheme.colorScheme.error,
    )
    error.retryAfterSeconds?.let { Text(stringResource(R.string.settings_common_retry, it)) }
    if (ProblemCodeText.resId(error.code) == null) {
        error.traceId?.let {
            Text(stringResource(R.string.settings_common_support, it), style = MaterialTheme.typography.bodySmall)
        }
    }
}
