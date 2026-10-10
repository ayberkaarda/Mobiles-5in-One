package app.cetele.android.feature.shop

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.component.CeteleTextField
import app.cetele.android.core.designsystem.component.CeteleTopBar
import app.cetele.android.core.designsystem.copy.FieldErrorText
import app.cetele.android.core.domain.validation.FieldCodes
import app.cetele.android.core.domain.validation.FieldError
import app.cetele.android.core.network.dto.ShopType

@Composable
internal fun ShopContent(
    title: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier) {
        CeteleTopBar(title = title, onBack = onBack)
        Column(
            modifier = Modifier.verticalScroll(rememberScrollState()).padding(CeteleSpacing.screenGutter),
            verticalArrangement = Arrangement.spacedBy(CeteleSpacing.regular),
            content = content,
        )
    }
}

@Composable
internal fun ShopFormFields(
    state: ShopFormState,
    onChange: (ShopForm) -> Unit,
) {
    val form = state.form
    Column(verticalArrangement = Arrangement.spacedBy(CeteleSpacing.regular)) {
        CeteleTextField(
            form.name,
            { onChange(form.copy(name = it)) },
            stringResource(R.string.shop_form_name),
            modifier = Modifier.fillMaxWidth(),
            error = formError(state.errors, "name"),
            enabled = !state.busy,
        )
        Text(stringResource(R.string.shop_form_type))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(CeteleSpacing.small)) {
            for (type in ShopType.entries) {
                FilterChip(
                    selected = form.type == type,
                    onClick = { onChange(form.copy(type = type)) },
                    label = { Text(stringResource(typeLabel(type))) },
                    enabled = !state.busy,
                )
            }
        }
        formError(state.errors, "type")?.let { Text(it) }
        CeteleTextField(
            form.il,
            { onChange(form.copy(il = it)) },
            stringResource(R.string.shop_form_il),
            modifier = Modifier.fillMaxWidth(),
            error = formError(state.errors, "il"),
            enabled = !state.busy,
        )
        CeteleTextField(
            form.ilce,
            { onChange(form.copy(ilce = it)) },
            stringResource(R.string.shop_form_ilce),
            modifier = Modifier.fillMaxWidth(),
            error = formError(state.errors, "ilce"),
            enabled = !state.busy,
        )
        ShopFailureText(state.failure)
    }
}

@Composable
private fun formError(
    errors: List<FieldError>,
    field: String,
): String? {
    val error = errors.firstOrNull { it.field == field } ?: return null
    val resource =
        if (error.code == FieldCodes.REQUIRED) {
            when (field) {
                "name" -> R.string.shop_form_name_required
                "type" -> R.string.shop_form_type_required
                "il" -> R.string.shop_form_il_required
                else -> R.string.shop_form_ilce_required
            }
        } else {
            FieldErrorText.resId(error)
        }
    return stringResource(resource)
}

private fun typeLabel(type: ShopType): Int =
    when (type) {
        ShopType.BAKKAL -> R.string.shop_form_bakkal
        ShopType.MANAV -> R.string.shop_form_manav
        ShopType.KASAP -> R.string.shop_form_kasap
        ShopType.BERBER -> R.string.shop_form_berber
        ShopType.KAHVEHANE -> R.string.shop_form_kahvehane
        ShopType.DIGER -> R.string.shop_form_other
    }
