package app.cetele.android.feature.auth.common

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.component.CeteleTopBar

@Composable
fun AuthPage(
    title: String,
    modifier: Modifier = Modifier,
    onBack: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Scaffold(modifier = modifier, topBar = { CeteleTopBar(title = title, onBack = onBack) }) { insets ->
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(
                        insets,
                    ).verticalScroll(rememberScrollState())
                    .padding(CeteleSpacing.screenGutter),
            verticalArrangement = Arrangement.spacedBy(CeteleSpacing.regular),
            content = content,
        )
    }
}
