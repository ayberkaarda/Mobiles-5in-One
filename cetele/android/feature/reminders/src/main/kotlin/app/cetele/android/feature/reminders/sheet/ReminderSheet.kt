package app.cetele.android.feature.reminders.sheet

import android.content.ActivityNotFoundException
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.component.BalanceBand
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.domain.format.DateFormats
import app.cetele.android.core.domain.model.Money
import app.cetele.android.core.domain.time.CeteleClock
import app.cetele.android.feature.reminders.R
import app.cetele.android.feature.reminders.WhatsAppIntents
import kotlinx.coroutines.flow.collect
import java.time.Instant

@Composable
fun ReminderSheetRoute(
    viewModel: ReminderViewModel,
    onDismiss: () -> Unit,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    LaunchedEffect(viewModel, context) {
        viewModel.shareRequests.collect { text ->
            val opened =
                try {
                    WhatsAppIntents.send(context, text)
                    true
                } catch (_: ActivityNotFoundException) {
                    false
                }
            viewModel.shareFinished(opened)
        }
    }
    ReminderSheet(state, viewModel::sendWhatsApp, viewModel::sendSms, onDismiss)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReminderSheet(
    state: ReminderState,
    onWhatsApp: () -> Unit,
    onSms: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, modifier = modifier) {
        Column(
            modifier =
                Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(CeteleSpacing.screenGutter),
            verticalArrangement = Arrangement.spacedBy(CeteleSpacing.small),
        ) {
            Text(stringResource(R.string.reminders_sheet_title), style = MaterialTheme.typography.titleLarge)
            state.customer?.let { Text(it.name) }
            BalanceBand(Money(state.balanceMinor))
            CeteleButton(
                stringResource(R.string.reminders_sheet_whatsapp),
                onWhatsApp,
                enabled = !state.busy && state.whatsappDisabledReason == null,
            )
            state.whatsappDisabledReason?.let { Text(stringResource(it)) }
            CeteleButton(
                stringResource(R.string.reminders_sheet_sms),
                onSms,
                enabled = !state.busy && state.smsDisabledReason == null,
            )
            state.smsDisabledReason?.let { Text(stringResource(it)) }
            state.quota?.let {
                Text(
                    stringResource(R.string.reminders_sheet_quota, it.used, it.limit),
                    style = MaterialTheme.typography.bodyLarge.copy(fontFeatureSettings = "tnum"),
                )
            } ?: Text(stringResource(R.string.reminders_sheet_quota_unknown))
            state.lastReminder?.let {
                val date = DateFormats.long(Instant.parse(it.sentAt).atZone(CeteleClock.ZONE).toLocalDate())
                val channel =
                    stringResource(
                        if (it.channel == "WHATSAPP") {
                            R.string.reminders_sheet_channel_whatsapp
                        } else {
                            R.string.reminders_sheet_channel_sms
                        },
                    )
                Text(stringResource(R.string.reminders_sheet_last, date, channel))
            }
            state.message?.takeUnless { it == state.smsDisabledReason || it == state.whatsappDisabledReason }?.let {
                Text(stringResource(it))
            }
            state.retrySeconds?.let { Text(stringResource(R.string.reminders_sheet_retry_after, it)) }
            state.traceId?.let {
                Text(stringResource(R.string.reminders_sheet_support, it), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
