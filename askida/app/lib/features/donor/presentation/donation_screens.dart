import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/donation.dart';
import 'package:askida/data/models/money.dart';
import 'package:askida/design/empty_state.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/typography.dart';
import 'package:askida/features/auth/presentation/widgets/form_parts.dart';
import 'package:askida/features/donor/presentation/donor_providers.dart';
import 'package:askida/features/impact/presentation/impact_section.dart';
import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:askida/routing/app_mode.dart';
import 'package:askida/routing/app_paths.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

String donationStatusLabel(AppLocalizations l10n, DonationStatus status) =>
    switch (status) {
      DonationStatus.initiated => l10n.donationStatusInitiated,
      DonationStatus.paid => l10n.donationStatusPaid,
      DonationStatus.failed => l10n.donationStatusFailed,
      DonationStatus.refunded => l10n.donationStatusRefunded,
    };

String _when(AppLocalizations l10n, DateTime? at) {
  if (at == null) return '';
  return DateFormat.yMMMd(l10n.localeName).add_Hm().format(at.toLocal());
}

/// "3 × Ekmek" (or the count alone when the item name is missing).
String donationLine(AppLocalizations l10n, Donation donation) => l10n
    .donationLine(donation.qty, donation.itemName ?? l10n.donationItemFallback);

/// `/donor/donation/:id?status=`: the receipt. The status always comes
/// from `GET donations/{id}`; the link's `status` only changes the wording
/// while the server has not recorded the payment yet.
class DonationReceiptScreen extends ConsumerWidget {
  const new({required this.donationId, this.linkStatus, super.key});

  final String donationId;
  final String? linkStatus;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final donation = ref.watch(donationProvider(donationId));
    return FormScreen(
      title: l10n.receiptTitle,
      onBack: () => context.go(AppPaths.donorDonations),
      children: [
        ...donation.when(
          skipLoadingOnRefresh: false,
          data: (d) => _receipt(context, ref, d),
          loading: () => const [
            Padding(
              padding: EdgeInsets.all(AskidaSpacing.s8),
              child: Center(child: CircularProgressIndicator()),
            ),
          ],
          error: (error, _) => [
            if (error is ApiProblem)
              ProblemBanner(problem: error)
            else
              MessageBanner(message: l10n.problemGeneric, error: true),
            formGapSmall,
            TextButton(
              onPressed: () => ref.invalidate(donationProvider(donationId)),
              child: Text(l10n.donorRetry),
            ),
          ],
        ),
      ],
    );
  }

  List<Widget> _receipt(BuildContext context, WidgetRef ref, Donation d) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final c = AskidaColors.of(context);
    final locale = l10n.localeName;
    final (
      IconData icon,
      Color color,
      String title,
      String body,
    ) = switch (d.status) {
      DonationStatus.paid => (
        Icons.check_circle_outline,
        c.success,
        l10n.receiptPaidTitle,
        l10n.receiptPaidBody,
      ),
      DonationStatus.initiated => (
        Icons.schedule,
        c.info,
        l10n.receiptPendingTitle,
        linkStatus == 'paid'
            ? l10n.receiptPendingConfirming
            : l10n.receiptPendingBody,
      ),
      DonationStatus.failed => (
        Icons.error_outline,
        c.dangerText,
        l10n.receiptFailedTitle,
        l10n.receiptFailedBody,
      ),
      DonationStatus.refunded => (
        Icons.undo,
        c.info,
        l10n.receiptRefundedTitle,
        l10n.receiptRefundedBody,
      ),
    };
    final commission = d.commissionMinor;
    Widget row(String label, String value, {Key? key}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: AskidaSpacing.s1),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: Text(label, style: theme.textTheme.bodyMedium)),
          const SizedBox(width: AskidaSpacing.s2),
          Flexible(
            child: Text(
              value,
              key: key,
              textAlign: TextAlign.end,
              style: theme.textTheme.bodyMedium?.copyWith(
                fontFeatures: Money.tabularFigures,
              ),
            ),
          ),
        ],
      ),
    );
    return [
      Semantics(
        liveRegion: true,
        child: Row(
          children: [
            Icon(icon, color: color, size: 32),
            const SizedBox(width: AskidaSpacing.s3),
            Expanded(
              child: Text(
                title,
                key: ValueKey('receipt-${d.status.name}'),
                style: theme.textTheme.titleLarge,
              ),
            ),
          ],
        ),
      ),
      formGapSmall,
      Text(body, style: theme.textTheme.bodyLarge),
      const SizedBox(height: AskidaSpacing.s6),
      Container(
        padding: const EdgeInsets.all(AskidaSpacing.s4),
        decoration: BoxDecoration(
          color: c.surface,
          borderRadius: BorderRadius.circular(AskidaRadius.card),
          border: Border.all(color: c.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (d.shopName != null)
              Text(d.shopName!, style: theme.textTheme.titleMedium),
            Text(donationLine(l10n, d), style: theme.textTheme.bodyLarge),
            formGapSmall,
            row(
              l10n.receiptAmount,
              Money(d.amountMinor).format(locale),
              key: const ValueKey('receipt-amount'),
            ),
            if (commission != null) ...[
              row(
                l10n.receiptToShop,
                Money(d.amountMinor - commission).format(locale),
              ),
              row(l10n.receiptCommission, Money(commission).format(locale)),
            ],
            if (d.paidAt != null || d.createdAt != null)
              row(l10n.receiptDate, _when(l10n, d.paidAt ?? d.createdAt)),
            row(l10n.receiptStatus, donationStatusLabel(l10n, d.status)),
          ],
        ),
      ),
      formGapSmall,
      Text(
        l10n.receiptAnonymityNote,
        style: AskidaTypography.footnote.copyWith(color: c.textMuted),
      ),
      const SizedBox(height: AskidaSpacing.s6),
      if (d.status == DonationStatus.initiated) ...[
        BusyButton(
          key: const ValueKey('receipt-refresh'),
          label: l10n.receiptRefresh,
          onPressed: () => ref.invalidate(donationProvider(donationId)),
        ),
        formGapSmall,
        BusyButton(
          label: l10n.receiptBackToShops,
          tonal: true,
          onPressed: () => context.go(AppMode.donor.path),
        ),
      ] else ...[
        BusyButton(
          key: const ValueKey('receipt-history'),
          label: l10n.donorHistoryLink,
          onPressed: () => context.go(AppPaths.donorDonations),
        ),
        formGapSmall,
        BusyButton(
          label: l10n.receiptBackToShops,
          tonal: true,
          onPressed: () => context.go(AppMode.donor.path),
        ),
      ],
    ];
  }
}

/// `/donor/donations`: the donor's donations, newest first, with the
/// impact card on top. Rows open the receipt.
class DonationHistoryScreen extends ConsumerWidget {
  const new({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final history = ref.watch(donationHistoryProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.historyTitle),
        leading: BackButton(onPressed: () => context.go(AppMode.donor.path)),
      ),
      body: history.when(
        data: (data) {
          if (data.donations.isEmpty) {
            return EmptyState(
              title: l10n.donorEmptyTitle,
              body: l10n.historyEmptyBody,
            );
          }
          return RefreshIndicator(
            onRefresh: () => ref.refresh(donationHistoryProvider.future),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                AskidaLayout.screenGutter,
                AskidaSpacing.s4,
                AskidaLayout.screenGutter,
                AskidaSpacing.s8,
              ),
              children: [
                const ImpactSection(),
                formGap,
                for (final donation in data.donations) ...[
                  DonationRow(
                    donation: donation,
                    onTap: () => context.go(AppPaths.donation(donation.id)),
                  ),
                  formGapSmall,
                ],
                if (data.hasMore)
                  Center(
                    child: data.loadingMore
                        ? const CircularProgressIndicator()
                        : TextButton(
                            key: const ValueKey('history-more'),
                            onPressed: () => ref
                                .read(donationHistoryProvider.notifier)
                                .loadMore(),
                            child: Text(l10n.historyMore),
                          ),
                  ),
              ],
            ),
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => ListView(
          padding: const EdgeInsets.all(AskidaLayout.screenGutter),
          children: [
            if (error is ApiProblem)
              ProblemBanner(problem: error)
            else
              MessageBanner(message: l10n.problemGeneric, error: true),
            formGapSmall,
            TextButton(
              onPressed: () => ref.invalidate(donationHistoryProvider),
              child: Text(l10n.donorRetry),
            ),
          ],
        ),
      ),
    );
  }
}

/// One donation in the history: shop, "3 × Ekmek", amount, date, status.
class DonationRow extends StatelessWidget {
  const new({required this.donation, required this.onTap, super.key});

  final Donation donation;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final c = AskidaColors.of(context);
    final theme = Theme.of(context);
    final amount = Money(donation.amountMinor).format(l10n.localeName);
    final status = donationStatusLabel(l10n, donation.status);
    final line = donationLine(l10n, donation);
    final shop = donation.shopName ?? '';
    final at = donation.paidAt ?? donation.createdAt;
    return Semantics(
      button: true,
      label: '$shop, $line, $amount, $status',
      excludeSemantics: true,
      child: Material(
        key: ValueKey('donation-${donation.id}'),
        color: c.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AskidaRadius.row),
          side: BorderSide(color: c.border),
        ),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AskidaRadius.row),
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              minHeight: AskidaLayout.rowMinHeight,
            ),
            child: Padding(
              padding: const EdgeInsets.all(AskidaSpacing.s4),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (shop.isNotEmpty)
                          Text(shop, style: theme.textTheme.titleMedium),
                        Text(line, style: theme.textTheme.bodyMedium),
                        Text(
                          [if (at != null) _when(l10n, at), status].join(' · '),
                          style: AskidaTypography.footnote.copyWith(
                            color: c.textMuted,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: AskidaSpacing.s2),
                  Text(
                    amount,
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontFeatures: Money.tabularFigures,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
