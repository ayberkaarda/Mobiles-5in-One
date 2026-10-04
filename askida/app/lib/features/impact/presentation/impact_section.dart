import 'package:askida/data/session.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/features/impact/impact_providers.dart';
import 'package:askida/features/impact/presentation/impact_card.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Loads the public counters of [area] and, for a signed-in donor, their
/// own numbers, and shows the [ImpactCard]. While loading it keeps a quiet
/// placeholder of the same width; when the counters cannot be loaded it
/// says so in one line (the rest of the screen keeps working).
class ImpactSection extends ConsumerWidget {
  const new({this.area = const ImpactArea(), super.key});

  final ImpactArea area;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final c = AskidaColors.of(context);
    final summary = ref.watch(impactSummaryProvider(area));
    final isDonor = ref.watch(sessionProvider.select((s) => s.isDonor));
    final donor = isDonor ? ref.watch(donorImpactProvider).value : null;
    return summary.when(
      data: (data) => ImpactCard(summary: data, donor: donor),
      loading: () => Semantics(
        label: l10n.impactLoading,
        child: Container(
          height: 96,
          decoration: BoxDecoration(
            color: c.surface,
            borderRadius: BorderRadius.circular(AskidaRadius.card),
            border: Border.all(color: c.border),
          ),
        ),
      ),
      error: (_, _) => Text(
        l10n.impactUnavailable,
        key: const ValueKey('impact-unavailable'),
        style: Theme.of(context).textTheme.bodySmall
            ?.copyWith(color: c.textMuted),
      ),
    );
  }
}
