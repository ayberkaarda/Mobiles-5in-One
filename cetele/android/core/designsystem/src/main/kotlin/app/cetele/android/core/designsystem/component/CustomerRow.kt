package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.domain.format.PhoneFormat
import app.cetele.android.core.domain.model.Money

@Composable
fun CustomerRow(
    name: String,
    balance: Money,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    phone: String? = null,
    tag: String? = null,
) {
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .heightIn(min = CeteleSpacing.rowMinHeight)
                .clickable(role = Role.Button, onClick = onClick)
                .padding(CeteleSpacing.screenGutter),
        horizontalArrangement = Arrangement.spacedBy(CeteleSpacing.medium),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(name, style = CeteleTextStyles.bodyStrong)
            if (phone != null) {
                Text(
                    text = PhoneFormat.toE164Tr(phone)?.let(PhoneFormat::display) ?: phone,
                    style = CeteleTextStyles.caption,
                    color = CeteleTheme.colors.textMuted,
                )
            }
            if (tag != null) Text(tag, style = CeteleTextStyles.caption, color = CeteleTheme.colors.textMuted)
        }
        AmountText(balance, tone = balanceTone(balance))
    }
}
