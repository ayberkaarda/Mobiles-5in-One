import 'package:askida/l10n/l10n.dart';
import 'package:askida/routing/app_mode.dart';
import 'package:flutter/material.dart';

/// The three-segment mode control: Askıdan al · Askıya bırak · Esnaf.
///
/// The order is [AppMode.values]; the recipient mode comes first and is the
/// default. The modes have no colours of their own; the look comes from the
/// segmented button theme (secondary track, primary selected segment).
class ModeSwitcher extends StatelessWidget {
  const new({required this.selected, required this.onChanged, super.key});

  final AppMode selected;
  final ValueChanged<AppMode> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Semantics(
      container: true,
      label: l10n.modeSwitcherLabel,
      child: SegmentedButton<AppMode>(
        segments: [
          for (final mode in AppMode.values)
            ButtonSegment(
              value: mode,
              label: Text(
                mode.label(l10n),
                key: ValueKey('mode-${mode.name}'),
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ),
        ],
        selected: {selected},
        onSelectionChanged: (selection) => onChanged(selection.single),
        showSelectedIcon: false,
        expandedInsets: EdgeInsets.zero,
      ),
    );
  }
}
