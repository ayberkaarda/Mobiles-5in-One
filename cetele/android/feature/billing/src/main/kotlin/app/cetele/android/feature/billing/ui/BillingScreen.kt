package app.cetele.android.feature.billing.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.designsystem.component.BannerKind
import app.cetele.android.core.designsystem.component.ButtonStyle
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.designsystem.component.CeteleTopBar
import app.cetele.android.core.designsystem.component.SectionHeader
import app.cetele.android.core.designsystem.component.StatusBanner
import app.cetele.android.core.domain.format.DateFormats
import app.cetele.android.core.domain.model.ShopPlan
import app.cetele.android.feature.billing.BillingProduct
import app.cetele.android.feature.billing.R
import app.cetele.android.feature.billing.data.BillingOverview
import app.cetele.android.feature.billing.data.SubscriptionStatus
import app.cetele.android.feature.billing.data.SubscriptionSummary

@Composable
internal fun BillingScreen(
    state: BillingUiState,
    actions: BillingActions,
) {
    Scaffold(topBar = { CeteleTopBar(stringResource(R.string.billing_title), onBack = actions.onBack) }) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(CeteleSpacing.screenGutter),
            verticalArrangement = Arrangement.spacedBy(CeteleSpacing.regular),
        ) {
            if (state.busy) {
                val loading = stringResource(R.string.billing_loading)
                LinearProgressIndicator(Modifier.fillMaxWidth().semantics { contentDescription = loading })
            }
            state.notice?.let { NoticeBanner(it, actions.onDismissNotice) }
            when {
                state.shop == null -> Text(stringResource(R.string.billing_no_shop), style = CeteleTextStyles.body)
                state.overview == null && state.loadError != null -> LoadError(state.loadError, actions.onReload)
                state.overview != null -> Content(state, state.overview, actions)
            }
        }
    }
}

@Composable
private fun ColumnScope.Content(
    state: BillingUiState,
    overview: BillingOverview,
    actions: BillingActions,
) {
    PlanCard(overview)
    if (state.pendingPayment || overview.subscription?.status == SubscriptionStatus.PENDING) {
        StatusBanner(BannerKind.Info, stringResource(R.string.billing_pending_payment))
    }
    UsageCard(overview)
    when {
        !state.isOwner -> StatusBanner(BannerKind.Info, stringResource(R.string.billing_staff_info))
        state.showManage -> ManageSection(state, actions)
        state.showOffers -> OffersSection(state, actions)
    }
}

@Composable
private fun PlanCard(overview: BillingOverview) {
    BillingCard {
        Text(stringResource(R.string.billing_plan_heading), style = CeteleTextStyles.caption)
        Text(
            stringResource(
                if (overview.plan ==
                    ShopPlan.PRO
                ) {
                    R.string.billing_plan_pro
                } else {
                    R.string.billing_plan_free
                },
            ),
            style = CeteleTextStyles.title,
        )
        overview.subscription?.let { SubscriptionLines(it) }
    }
}

@Composable
private fun ColumnScope.SubscriptionLines(subscription: SubscriptionSummary) {
    Text(
        stringResource(R.string.billing_status_line, stringResource(statusText(subscription.status))),
        style = CeteleTextStyles.body,
    )
    when (subscription.basePlanId) {
        BillingProduct.MONTHLY -> R.string.billing_base_plan_monthly
        BillingProduct.YEARLY -> R.string.billing_base_plan_yearly
        else -> null
    }?.let { Text(stringResource(it), style = CeteleTextStyles.body) }
    subscription.expiresAt?.let { expires ->
        val date = longDate(expires)
        val text =
            if (subscription.autoRenewing && subscription.entitled) {
                stringResource(R.string.billing_renews_on, date)
            } else {
                stringResource(R.string.billing_valid_until, date)
            }
        Text(text, style = CeteleTextStyles.body, color = CeteleTheme.colors.textMuted)
    }
    if (subscription.testPurchase) {
        Text(stringResource(R.string.billing_test_purchase), style = CeteleTextStyles.caption)
    }
}

@Composable
private fun UsageCard(overview: BillingOverview) {
    BillingCard {
        Text(stringResource(R.string.billing_usage_heading), style = CeteleTextStyles.titleSmall)
        overview.month?.let {
            Text(
                stringResource(R.string.billing_usage_month, DateFormats.monthYear(it)),
                style = CeteleTextStyles.caption,
            )
        }
        Text(customersText(overview.customers), style = CeteleTextStyles.body)
        Text(usageText(R.string.billing_usage_photos, overview.photos), style = CeteleTextStyles.body)
        Text(usageText(R.string.billing_usage_sms, overview.sms), style = CeteleTextStyles.body)
    }
}

@Composable
private fun ColumnScope.OffersSection(
    state: BillingUiState,
    actions: BillingActions,
) {
    SectionHeader(stringResource(R.string.billing_offers_heading))
    Text(stringResource(R.string.billing_offers_benefits), style = CeteleTextStyles.body)
    if (state.storeUnavailable) {
        StatusBanner(BannerKind.Warning, stringResource(R.string.billing_offers_unavailable))
    }
    state.offers.forEach { offer ->
        val yearly = offer.basePlanId == BillingProduct.YEARLY
        val label =
            stringResource(
                if (yearly) R.string.billing_offer_yearly else R.string.billing_offer_monthly,
                offer.formattedPrice,
            )
        val description =
            stringResource(
                if (yearly) R.string.billing_offer_yearly_description else R.string.billing_offer_monthly_description,
                offer.formattedPrice,
            )
        CeteleButton(
            label,
            { actions.onSubscribe(offer) },
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = description },
            style = if (yearly) ButtonStyle.Primary else ButtonStyle.Tonal,
            enabled = !state.busy,
            loading = state.purchasing,
        )
    }
    CeteleButton(
        stringResource(R.string.billing_restore),
        actions.onRestore,
        modifier = Modifier.fillMaxWidth(),
        style = ButtonStyle.Outlined,
        enabled = !state.busy,
    )
}

@Composable
private fun ColumnScope.ManageSection(
    state: BillingUiState,
    actions: BillingActions,
) {
    val manageDescription = stringResource(R.string.billing_manage_description)
    CeteleButton(
        stringResource(R.string.billing_manage),
        actions.onManage,
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = manageDescription },
    )
    if (state.canSwitchPlan) {
        val current = state.overview?.subscription?.basePlanId
        state.offers.filter { it.basePlanId != current }.forEach { offer ->
            val label =
                if (offer.basePlanId == BillingProduct.YEARLY) {
                    R.string.billing_switch_yearly
                } else {
                    R.string.billing_switch_monthly
                }
            CeteleButton(
                stringResource(label, offer.formattedPrice),
                { actions.onSubscribe(offer) },
                modifier = Modifier.fillMaxWidth(),
                style = ButtonStyle.Outlined,
                enabled = !state.busy,
                loading = state.purchasing,
            )
        }
    }
    CeteleButton(
        stringResource(R.string.billing_restore),
        actions.onRestore,
        modifier = Modifier.fillMaxWidth(),
        style = ButtonStyle.Text,
        enabled = !state.busy,
    )
}

@Composable
private fun LoadError(
    error: BillingNotice.Problem,
    onReload: () -> Unit,
) {
    StatusBanner(BannerKind.Error, noticeText(error)) {
        CeteleButton(stringResource(R.string.billing_reload), onReload, style = ButtonStyle.Text)
    }
}

@Composable
private fun NoticeBanner(
    notice: BillingNotice,
    onDismiss: () -> Unit,
) {
    val kind =
        when (notice) {
            BillingNotice.Linked, BillingNotice.Queued, BillingNotice.NothingToRestore -> BannerKind.Info
            BillingNotice.StoreUnavailable -> BannerKind.Warning
            BillingNotice.StoreError, is BillingNotice.Problem -> BannerKind.Error
        }
    StatusBanner(kind, noticeText(notice)) {
        CeteleButton(stringResource(R.string.billing_dismiss), onDismiss, style = ButtonStyle.Text)
    }
}

@Composable
private fun BillingCard(content: @Composable ColumnScope.() -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = CeteleTheme.colors.surfaceRaised,
        contentColor = CeteleTheme.colors.text,
        shape = MaterialTheme.shapes.medium,
    ) {
        Column(
            Modifier.padding(CeteleSpacing.regular),
            verticalArrangement = Arrangement.spacedBy(CeteleSpacing.extraSmall),
            content = content,
        )
    }
}
