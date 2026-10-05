import 'dart:async';

import 'package:askida/core/qr/qr_scanner.dart';
import 'package:askida/data/models/reservation.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/typography.dart';
import 'package:askida/features/merchant/domain/redemption_code.dart';
import 'package:askida/features/merchant/presentation/providers/merchant_providers.dart';
import 'package:askida/features/merchant/presentation/widgets/merchant_page.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

/// Typed codes: ASCII letters in capitals, digits, one optional space.
final TextInputFormatter codeInputFormatter = TextInputFormatter.withFunction((
  oldValue,
  newValue,
) {
  final cleaned = RedemptionCode.asciiUpper(newValue.text)
      .replaceAll(RegExp('[^0-9A-Z ]'), '');
  if (cleaned.length > RedemptionCode.length + 1) return oldValue;
  return TextEditingValue(
    text: cleaned,
    selection: TextSelection.collapsed(offset: cleaned.length),
  );
});

/// Redemption: the recipient's QR is scanned (or the code typed), the
/// server checks it, and the merchant sees only what to hand over:
/// "1 ekmek verildi". Nothing about the person is ever on this screen.
class RedeemScreen extends ConsumerStatefulWidget {
  const new({super.key});

  @override
  ConsumerState<RedeemScreen> createState() => _RedeemScreenState();
}

class _RedeemScreenState extends ConsumerState<RedeemScreen> {
  late final QrScanner _scanner;
  StreamSubscription<String>? _scans;
  final _manual = TextEditingController();
  bool _cameraFailed = false;

  @override
  void initState() {
    super.initState();
    _scanner = ref.read(qrScannerFactoryProvider)();
    _scans = _scanner.codes.listen(_onScan);
    unawaited(_startCamera());
  }

  Future<void> _startCamera() async {
    try {
      await _scanner.start();
      if (mounted && _cameraFailed) setState(() => _cameraFailed = false);
    } on Object {
      if (mounted) setState(() => _cameraFailed = true);
    }
  }

  void _onScan(String value) {
    if (ref.read(redeemControllerProvider) is RedeemIdle) {
      unawaited(ref.read(redeemControllerProvider.notifier).submit(value));
    }
  }

  void _submitManual() {
    FocusScope.of(context).unfocus();
    unawaited(ref.read(redeemControllerProvider.notifier).submit(_manual.text));
  }

  void _again() {
    _manual.clear();
    ref.read(redeemControllerProvider.notifier).reset();
  }

  @override
  void dispose() {
    unawaited(_scans?.cancel());
    unawaited(_scanner.dispose());
    _manual.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    ref.listen(redeemControllerProvider, (previous, next) {
      // The camera only runs while it is waiting for a code.
      if (next is RedeemIdle) {
        unawaited(_startCamera());
      } else if (previous is RedeemIdle) {
        unawaited(_scanner.stop().catchError((Object _) {}));
      }
    });
    final state = ref.watch(redeemControllerProvider);
    return MerchantPage(
      title: l10n.merchantRedeemTitle,
      child: switch (state) {
        RedeemDone(:final result) => RedeemSuccessView(
          result: result,
          onNext: _again,
        ),
        RedeemFailed(:final problem) => _RedeemFailureView(
          message: problem == null
              ? l10n.merchantRedeemMalformed
              : errorMessage(l10n, problem),
          onRetry: _again,
        ),
        RedeemBusy(:final code) => _BusyView(code: code),
        RedeemIdle() => _scannerView(),
      },
    );
  }

  Widget _scannerView() {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final c = AskidaColors.of(context);
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AskidaLayout.screenGutter,
        0,
        AskidaLayout.screenGutter,
        AskidaSpacing.s8,
      ),
      children: [
        Semantics(
          label: l10n.merchantScannerLabel,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(AskidaRadius.card),
            child: ColoredBox(
              color: c.surfaceSunken,
              child: SizedBox(
                height: 260,
                child: _cameraFailed
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(AskidaSpacing.s4),
                          child: Text(
                            l10n.merchantCameraFailed,
                            key: const ValueKey('camera-failed'),
                            textAlign: TextAlign.center,
                            style: theme.textTheme.bodyMedium,
                          ),
                        ),
                      )
                    : _scanner.preview(),
              ),
            ),
          ),
        ),
        const SizedBox(height: AskidaSpacing.s2),
        Row(
          children: [
            Expanded(
              child: Text(
                l10n.merchantScannerHint,
                style: theme.textTheme.bodySmall?.copyWith(color: c.textMuted),
              ),
            ),
            ValueListenableBuilder<bool>(
              valueListenable: _scanner.torchOn,
              builder: (context, on, _) => IconButton(
                tooltip: on ? l10n.merchantTorchOff : l10n.merchantTorchOn,
                onPressed: _cameraFailed
                    ? null
                    : () => unawaited(
                        _scanner.toggleTorch().catchError((Object _) {}),
                      ),
                icon: Icon(on ? Icons.flash_on : Icons.flash_off),
              ),
            ),
          ],
        ),
        const SizedBox(height: AskidaSpacing.s4),
        Text(l10n.merchantManualTitle, style: theme.textTheme.titleSmall),
        const SizedBox(height: AskidaSpacing.s2),
        TextField(
          key: const ValueKey('manual-code'),
          controller: _manual,
          autocorrect: false,
          enableSuggestions: false,
          textCapitalization: TextCapitalization.characters,
          inputFormatters: [codeInputFormatter],
          style: AskidaTypography.code.copyWith(color: c.text, fontSize: 24),
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => _submitManual(),
          decoration: InputDecoration(
            labelText: l10n.merchantManualField,
            hintText: 'K7M2 QX9R',
          ),
        ),
        const SizedBox(height: AskidaSpacing.s3),
        FilledButton(
          key: const ValueKey('manual-submit'),
          onPressed: _submitManual,
          child: Text(l10n.merchantManualSubmit),
        ),
      ],
    );
  }
}

class _BusyView extends StatelessWidget {
  const new({required this.code});

  final String code;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Center(
      child: Semantics(
        liveRegion: true,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: AskidaSpacing.s4),
            Text(l10n.merchantRedeemChecking),
            const SizedBox(height: AskidaSpacing.s2),
            Text(
              RedemptionCode.grouped(code),
              style: AskidaTypography.code.copyWith(
                color: AskidaColors.of(context).textMuted,
                fontSize: 24,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// "Kod onaylandı · 1 ekmek verildi": item and time, nothing else.
class RedeemSuccessView extends StatelessWidget {
  const new({required this.result, required this.onNext, super.key});

  final RedeemResult result;
  final VoidCallback onNext;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final c = AskidaColors.of(context);
    final time = DateFormat.Hm(l10n.localeName)
        .format(result.redeemedAt.toLocal());
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(AskidaSpacing.s6),
        child: Column(
          key: const ValueKey('redeem-success'),
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              liveRegion: true,
              child: Column(
                children: [
                  ExcludeSemantics(
                    child: Icon(Icons.check_circle, size: 56, color: c.success),
                  ),
                  const SizedBox(height: AskidaSpacing.s3),
                  Text(
                    l10n.merchantRedeemApproved,
                    textAlign: TextAlign.center,
                    style: theme.textTheme.titleMedium?.copyWith(
                      color: c.success,
                    ),
                  ),
                  const SizedBox(height: AskidaSpacing.s2),
                  Text(
                    l10n.merchantRedeemGiven(result.item.name),
                    textAlign: TextAlign.center,
                    style: theme.textTheme.headlineMedium,
                  ),
                  const SizedBox(height: AskidaSpacing.s2),
                  Text(
                    l10n.merchantRedeemAt(time),
                    textAlign: TextAlign.center,
                    style: AskidaTypography.footnote.copyWith(
                      color: c.textMuted,
                      fontFeatures: AskidaTypography.numeral.fontFeatures,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AskidaSpacing.s8),
            FilledButton(
              key: const ValueKey('redeem-next'),
              onPressed: onNext,
              child: Text(l10n.merchantRedeemNext),
            ),
          ],
        ),
      ),
    );
  }
}

class _RedeemFailureView extends StatelessWidget {
  const new({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final c = AskidaColors.of(context);
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(AskidaSpacing.s6),
        child: Column(
          key: const ValueKey('redeem-failure'),
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ExcludeSemantics(
              child: Icon(Icons.error_outline, size: 56, color: c.dangerText),
            ),
            const SizedBox(height: AskidaSpacing.s3),
            Semantics(
              liveRegion: true,
              child: Text(
                message,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyLarge,
              ),
            ),
            const SizedBox(height: AskidaSpacing.s8),
            FilledButton(
              key: const ValueKey('redeem-retry'),
              onPressed: onRetry,
              child: Text(l10n.merchantRedeemRetry),
            ),
          ],
        ),
      ),
    );
  }
}
