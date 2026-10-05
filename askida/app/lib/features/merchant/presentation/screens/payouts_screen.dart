import 'package:askida/data/models/money.dart';
import 'package:askida/data/models/payout.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/typography.dart';
import 'package:askida/features/merchant/presentation/providers/merchant_providers.dart';
import 'package:askida/features/merchant/presentation/widgets/merchant_page.dart';
import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

String payoutStatusLabel(AppLocalizations l10n, PayoutStatus status) =>
    switch (status) {
      PayoutStatus.pending => l10n.merchantPayoutPending,
      PayoutStatus.paid => l10n.merchantPayoutPaid,
      PayoutStatus.held => l10n.merchantPayoutHeld,
      PayoutStatus.failed => l10n.merchantPayoutFailed,
    };

/// The payout ledger, one row per day: what was left on the rail, the
/// platform commission (shown openly), the net amount, how many items were
/// handed over, and the settlement status from the payment provider.
class PayoutsScreen extends ConsumerWidget {
  const new({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final payouts = ref.watch(payoutsProvider);
    return MerchantPage(
      title: l10n.merchantPayoutsTitle,
      child: switch (payouts) {
        AsyncData(:final value) => RefreshIndicator(
          onRefresh: () => ref.refresh(payoutsProvider.future),
          child: ListView(
            padding: const EdgeInsets.only(bottom: AskidaSpacing.s8),
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AskidaLayout.screenGutter,
                  0,
                  AskidaLayout.screenGutter,
                  AskidaSpacing.s3,
                ),
                child: Text(
                  l10n.merchantPayoutsBody,
                  style: Theme.of(context).textTheme.bodyMedium
                      ?.copyWith(color: AskidaColors.of(context).textMuted),
                ),
              ),
              if (value.isEmpty)
                Padding(
                  padding: const EdgeInsets.all(AskidaLayout.screenGutter),
                  child: Text(
                    l10n.merchantPayoutsEmpty,
                    style: Theme.of(context).textTheme.bodyLarge,
                  ),
                ),
              for (final payout in value) PayoutRow(payout: payout),
            ],
          ),
        ),
        AsyncError(:final error) => ProblemView(
          error: error,
          onRetry: () => ref.invalidate(payoutsProvider),
        ),
        _ => const Center(child: CircularProgressIndicator()),
      },
    );
  }
}

class PayoutRow extends StatelessWidget {
  const new({required this.payout, super.key});

  final Payout payout;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final c = AskidaColors.of(context);
    final locale = l10n.localeName;
    String money(int minor) => Money(minor).format(locale);
    final day = DateTime.tryParse(payout.day);
    final dayLabel = day == null
        ? payout.day
        : DateFormat.yMMMd(locale).format(day);
    return Container(
      key: ValueKey('payout-${payout.day}'),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: c.border)),
      ),
      padding: const EdgeInsets.symmetric(
        horizontal: AskidaLayout.screenGutter,
        vertical: AskidaSpacing.s3,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: AskidaSpacing.s2,
            runSpacing: AskidaSpacing.s1,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(dayLabel, style: theme.textTheme.titleSmall),
              // The quiet chip carries only ink (design rule for the
              // secondary fill); the label alone tells the status.
              QuietChip(label: payoutStatusLabel(l10n, payout.status)),
            ],
          ),
          const SizedBox(height: AskidaSpacing.s1),
          Text(
            money(payout.netMinor),
            style: AskidaTypography.numeral.copyWith(color: c.text),
            semanticsLabel: l10n.merchantPayoutNet(money(payout.netMinor)),
          ),
          Text(
            l10n.merchantPayoutBreakdown(
              money(payout.donatedMinor),
              money(payout.commissionMinor),
            ),
            style: theme.textTheme.bodySmall?.copyWith(
              color: c.textMuted,
              fontFeatures: Money.tabularFigures,
            ),
          ),
          Text(
            l10n.merchantPayoutRedeemed(payout.redeemedCount),
            style: theme.textTheme.bodySmall?.copyWith(color: c.textMuted),
          ),
        ],
      ),
    );
  }
}
