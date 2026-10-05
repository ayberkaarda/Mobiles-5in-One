import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/typography.dart';
import 'package:askida/features/discovery/domain/districts.dart';
import 'package:askida/features/discovery/presentation/coarse_location.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Onboarding screen 2 of 3: an approximate location for nearby shops.
/// "Konumu kullan" (rounded to two decimals) and "İlçe seç" are equal
/// alternatives; when the system will not ask again only the district
/// picker remains.
class LocationStep extends ConsumerStatefulWidget {
  const new({super.key});

  @override
  ConsumerState<LocationStep> createState() => _LocationStepState();
}

class _LocationStepState extends ConsumerState<LocationStep> {
  bool _locating = false;

  Future<void> _useLocation() async {
    setState(() => _locating = true);
    try {
      await ref.read(coarseLocationProvider.notifier).requestAndLocate();
    } on Object {
      // No location plugin or no answer: the district picker stays offered.
    }
    if (mounted) setState(() => _locating = false);
  }

  Future<void> _pickDistrict() async {
    final district = await showDistrictPicker(context);
    if (district != null) {
      ref.read(coarseLocationProvider.notifier).chooseDistrict(district);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = AskidaColors.of(context);
    final l10n = context.l10n;
    final location = ref.watch(coarseLocationProvider);
    final onlyDistricts = location.offerDistricts;
    return ListView(
      key: const ValueKey('recipient-location'),
      padding: const EdgeInsets.all(AskidaLayout.screenGutter),
      children: [
        const SizedBox(height: AskidaSpacing.s4),
        Text(
          l10n.recipientLocationTitle,
          style: AskidaTypography.title1.copyWith(color: c.text),
        ),
        const SizedBox(height: AskidaSpacing.s3),
        Text(
          l10n.recipientLocationBody,
          style: AskidaTypography.body.copyWith(color: c.text),
        ),
        if (onlyDistricts) ...[
          const SizedBox(height: AskidaSpacing.s3),
          Semantics(
            liveRegion: true,
            child: Text(
              location.failed
                  ? l10n.recipientLocationFailed
                  : l10n.recipientLocationBlocked,
              key: const ValueKey('recipient-location-blocked'),
              style: AskidaTypography.body.copyWith(color: c.textMuted),
            ),
          ),
        ],
        const SizedBox(height: AskidaSpacing.s6),
        if (!onlyDistricts) ...[
          FilledButton(
            key: const ValueKey('recipient-use-location'),
            onPressed: _locating ? null : _useLocation,
            child: Text(l10n.recipientUseLocation),
          ),
          const SizedBox(height: AskidaSpacing.s3),
        ],
        FilledButton.tonal(
          key: const ValueKey('recipient-pick-district'),
          onPressed: _locating ? null : _pickDistrict,
          child: Text(l10n.recipientPickDistrict),
        ),
      ],
    );
  }
}

/// Bottom sheet listing [kPickerDistricts] by province.
Future<District?> showDistrictPicker(BuildContext context) =>
    showModalBottomSheet<District>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => const _DistrictSheet(),
    );

class _DistrictSheet extends StatelessWidget {
  const new();

  @override
  Widget build(BuildContext context) {
    final c = AskidaColors.of(context);
    final l10n = context.l10n;
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.7,
      maxChildSize: 0.95,
      builder: (context, controller) => ListView(
        controller: controller,
        padding: const EdgeInsets.symmetric(vertical: AskidaSpacing.s4),
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AskidaLayout.screenGutter,
            ),
            child: Text(
              l10n.recipientDistrictSheetTitle,
              style: AskidaTypography.title3.copyWith(color: c.text),
            ),
          ),
          for (final il in pickerProvinces()) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AskidaLayout.screenGutter,
                AskidaSpacing.s4,
                AskidaLayout.screenGutter,
                AskidaSpacing.s1,
              ),
              child: Semantics(
                header: true,
                child: Text(
                  il,
                  style: AskidaTypography.label.copyWith(color: c.textMuted),
                ),
              ),
            ),
            for (final district in kPickerDistricts.where((d) => d.il == il))
              ListTile(
                key: ValueKey('district-${district.il}-${district.ilce}'),
                minTileHeight: AskidaLayout.rowMinHeight,
                title: Text(district.ilce),
                onTap: () => Navigator.of(context).pop(district),
              ),
          ],
        ],
      ),
    );
  }
}
