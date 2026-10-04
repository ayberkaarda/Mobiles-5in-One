import 'package:askida/core/time/clock.dart';
import 'package:askida/data/models/reservation.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/typography.dart';
import 'package:askida/features/merchant/domain/redemption_days.dart';
import 'package:askida/features/merchant/presentation/providers/merchant_providers.dart';
import 'package:askida/features/merchant/presentation/widgets/merchant_page.dart';
import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

/// "Bugün", "Dün" or `3 Eki`.
String logDayLabel(AppLocalizations l10n, LogDay day, LogDay today) {
  if (day == today) return l10n.merchantDayToday;
  final yesterday = LogDay.of(DateTime(today.year, today.month, today.day - 1));
  if (day == yesterday) return l10n.merchantDayYesterday;
  return DateFormat.MMMd(l10n.localeName).format(day.start);
}

/// What was handed over, day by day, for the last 30 days. Each row is an
/// item and a time (and whether the owner or staff redeemed it); there is
/// nothing about who collected.
class RedemptionsScreen extends ConsumerStatefulWidget {
  const new({super.key});

  @override
  ConsumerState<RedemptionsScreen> createState() => _RedemptionsScreenState();
}

class _RedemptionsScreenState extends ConsumerState<RedemptionsScreen> {
  LogDay? _selected;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final days = recentLogDays(ref.watch(clockProvider)());
    final today = days.first;
    final selected = _selected ?? today;
    final log = ref.watch(redemptionLogProvider(selected));
    return MerchantPage(
      title: l10n.merchantRedemptionsTitle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            height: 56,
            child: ListView.separated(
              key: const ValueKey('day-strip'),
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(
                horizontal: AskidaLayout.screenGutter,
                vertical: AskidaSpacing.s1,
              ),
              itemCount: days.length,
              separatorBuilder: (_, _) =>
                  const SizedBox(width: AskidaSpacing.s2),
              itemBuilder: (context, index) {
                final day = days[index];
                return ChoiceChip(
                  key: ValueKey('day-${day.key}'),
                  label: Text(logDayLabel(l10n, day, today)),
                  selected: day == selected,
                  onSelected: (_) => setState(() => _selected = day),
                );
              },
            ),
          ),
          Expanded(
            child: switch (log) {
              AsyncData(:final value) => _DayList(
                view: value,
                dayLabel: logDayLabel(l10n, selected, today),
                onRefresh: () =>
                    ref.refresh(redemptionLogProvider(selected).future),
              ),
              AsyncError(:final error) => ProblemView(
                error: error,
                onRetry: () => ref.invalidate(redemptionLogProvider(selected)),
              ),
              _ => const Center(child: CircularProgressIndicator()),
            },
          ),
        ],
      ),
    );
  }
}

class _DayList extends StatelessWidget {
  const new({
    required this.view,
    required this.dayLabel,
    required this.onRefresh,
  });

  final RedemptionLogView view;
  final String dayLabel;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final c = AskidaColors.of(context);
    final rows = view.rows;
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        padding: const EdgeInsets.only(bottom: AskidaSpacing.s8),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AskidaLayout.screenGutter,
              AskidaSpacing.s3,
              AskidaLayout.screenGutter,
              AskidaSpacing.s3,
            ),
            child: Semantics(
              container: true,
              label: l10n.merchantRedemptionsCount(dayLabel, rows.length),
              excludeSemantics: true,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: [
                  Text(
                    '${rows.length}',
                    key: const ValueKey('day-count'),
                    style: AskidaTypography.numeral.copyWith(color: c.text),
                  ),
                  const SizedBox(width: AskidaSpacing.s2),
                  Expanded(
                    child: Text(
                      l10n.merchantRedemptionsCountTail,
                      style: theme.textTheme.bodyLarge,
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (view.offline)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AskidaLayout.screenGutter,
                0,
                AskidaLayout.screenGutter,
                AskidaSpacing.s3,
              ),
              child: Text(
                l10n.merchantRedemptionsOffline,
                key: const ValueKey('log-offline'),
                style: theme.textTheme.bodySmall?.copyWith(color: c.textMuted),
              ),
            ),
          if (rows.isEmpty)
            Padding(
              padding: const EdgeInsets.all(AskidaLayout.screenGutter),
              child: Text(
                l10n.merchantRedemptionsEmpty,
                style: theme.textTheme.bodyLarge?.copyWith(color: c.textMuted),
              ),
            ),
          for (final row in rows) _RedemptionRow(row: row),
        ],
      ),
    );
  }
}

class _RedemptionRow extends StatelessWidget {
  const new({required this.row});

  final Redemption row;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final c = AskidaColors.of(context);
    final time = DateFormat.Hm(l10n.localeName)
        .format(row.redeemedAt.toLocal());
    final role = switch (row.redeemedByRole) {
      'owner' => l10n.merchantRoleOwner,
      'staff' => l10n.merchantRoleStaff,
      _ => null,
    };
    return MerchantRow(
      title: l10n.merchantRedeemGiven(row.item.name),
      subtitle: role,
      trailing: Text(
        time,
        style: AskidaTypography.label.copyWith(
          color: c.textMuted,
          fontFeatures: AskidaTypography.numeral.fontFeatures,
        ),
      ),
    );
  }
}
