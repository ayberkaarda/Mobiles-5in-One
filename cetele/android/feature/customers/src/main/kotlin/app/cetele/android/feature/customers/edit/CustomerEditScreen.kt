package app.cetele.android.feature.customers.edit

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.designsystem.component.CeteleTextField
import app.cetele.android.core.designsystem.component.CeteleTopBar
import app.cetele.android.core.designsystem.component.PhoneTextField
import app.cetele.android.core.designsystem.component.ProblemBanner
import app.cetele.android.core.domain.format.DateFormats
import app.cetele.android.core.domain.model.ConsentSource
import app.cetele.android.feature.customers.R
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

@Composable
fun CustomerEditScreen(
    state: CustomerEditState,
    onName: (String) -> Unit,
    onPhone: (String) -> Unit,
    onNote: (String) -> Unit,
    onTag: (String) -> Unit,
    onConsent: (Boolean) -> Unit,
    onSource: (ConsentSource) -> Unit,
    onDate: (LocalDate) -> Unit,
    onSave: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Scaffold(modifier = modifier, topBar = {
        CeteleTopBar(stringResource(R.string.customers_edit_title), onBack = onBack)
    }) { padding ->
        Column(
            Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(CeteleSpacing.screenGutter),
            verticalArrangement = Arrangement.spacedBy(CeteleSpacing.regular),
        ) {
            if (state.loading) CircularProgressIndicator()
            state.problemCode?.let { ProblemBanner(it) }
            CustomerFields(state, onName, onPhone, onNote, onTag)
            ConsentToggle(state, onConsent)
            if (state.smsConsent) ConsentEvidence(state, onSource, onDate)
            CeteleButton(
                stringResource(R.string.customers_edit_save),
                onSave,
                modifier = Modifier.fillMaxWidth(),
                enabled = state.available && !state.loading,
                loading = state.saving,
            )
        }
    }
}

@Composable
private fun CustomerFields(
    state: CustomerEditState,
    onName: (String) -> Unit,
    onPhone: (String) -> Unit,
    onNote: (String) -> Unit,
    onTag: (String) -> Unit,
) {
    val enabled = state.available && !state.saving
    Column(verticalArrangement = Arrangement.spacedBy(CeteleSpacing.regular)) {
        CeteleTextField(
            state.name,
            onName,
            stringResource(R.string.customers_edit_name),
            modifier = Modifier.fillMaxWidth(),
            error = fieldCopy(state, "customer.name"),
            enabled = enabled,
        )
        PhoneTextField(
            state.phone,
            onPhone,
            label = stringResource(R.string.customers_edit_phone),
            modifier = Modifier.fillMaxWidth(),
            error = fieldCopy(state, "customer.phone"),
            enabled = enabled,
        )
        CeteleTextField(
            state.note,
            onNote,
            stringResource(R.string.customers_edit_note),
            modifier = Modifier.fillMaxWidth(),
            error = fieldCopy(state, "customer.note"),
            singleLine = false,
            enabled = enabled,
        )
        CeteleTextField(
            state.tag,
            onTag,
            stringResource(R.string.customers_edit_tag),
            modifier = Modifier.fillMaxWidth(),
            error = fieldCopy(state, "customer.tag"),
            enabled = enabled,
        )
    }
}

@Composable
private fun ConsentToggle(
    state: CustomerEditState,
    onConsent: (Boolean) -> Unit,
) {
    val label = stringResource(R.string.customers_edit_consent)
    Row(horizontalArrangement = Arrangement.spacedBy(CeteleSpacing.medium)) {
        Text(label, Modifier.weight(1f), style = CeteleTextStyles.body)
        Switch(
            checked = state.smsConsent,
            onCheckedChange = onConsent,
            modifier = Modifier.semantics { contentDescription = label },
            enabled = state.available && !state.saving,
        )
    }
}

@Composable
private fun fieldCopy(
    state: CustomerEditState,
    field: String,
): String? = state.errorResource(field)?.let { stringResource(it) }

@Composable
private fun ConsentEvidence(
    state: CustomerEditState,
    onSource: (ConsentSource) -> Unit,
    onDate: (LocalDate) -> Unit,
) {
    var dateVisible by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(CeteleSpacing.regular)) {
        Text(stringResource(R.string.customers_edit_consent_notice), style = CeteleTextStyles.body)
        Text(stringResource(R.string.customers_edit_source), style = CeteleTextStyles.bodyStrong)
        ConsentSource.entries.chunked(2).forEach { sources ->
            Row(horizontalArrangement = Arrangement.spacedBy(CeteleSpacing.small)) {
                sources.forEach { source ->
                    FilterChip(
                        selected = state.consentSource == source,
                        onClick = { onSource(source) },
                        enabled = !state.saving,
                        label = { Text(stringResource(sourceLabel(source))) },
                    )
                }
            }
        }
        fieldCopy(state, "customer.smsConsentSource")?.let { Text(it, style = CeteleTextStyles.body) }
        CeteleButton(
            text = stringResource(R.string.customers_edit_date, state.consentDate?.let(DateFormats::long).orEmpty()),
            onClick = { dateVisible = true },
            enabled = !state.saving,
        )
        fieldCopy(state, "customer.smsConsentAt")?.let { Text(it, style = CeteleTextStyles.body) }
        if (dateVisible) ConsentDatePicker(state.consentDate, onDate) { dateVisible = false }
    }
}

private fun sourceLabel(source: ConsentSource): Int =
    when (source) {
        ConsentSource.IN_PERSON -> R.string.customers_edit_source_person
        ConsentSource.PHONE -> R.string.customers_edit_source_phone
        ConsentSource.WRITTEN -> R.string.customers_edit_source_written
        ConsentSource.OTHER -> R.string.customers_edit_source_other
    }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ConsentDatePicker(
    date: LocalDate?,
    onDate: (LocalDate) -> Unit,
    onDismiss: () -> Unit,
) {
    val picker =
        rememberDatePickerState(
            initialSelectedDateMillis = date?.atStartOfDay(ZoneOffset.UTC)?.toInstant()?.toEpochMilli(),
        )
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = {
                picker.selectedDateMillis?.let { onDate(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate()) }
                onDismiss()
            }, enabled = picker.selectedDateMillis != null) {
                Text(
                    stringResource(R.string.customers_edit_date_confirm),
                )
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.customers_edit_cancel)) } },
    ) { DatePicker(state = picker) }
}
