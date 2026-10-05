import 'dart:async';

import 'package:askida/core/time/clock.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/typography.dart';
import 'package:askida/design/widgets/code_tag.dart';
import 'package:askida/features/recipient/data/screen_brightness.dart';
import 'package:askida/features/recipient/domain/active_code.dart';
import 'package:askida/features/recipient/domain/code_timing.dart';
import 'package:askida/features/recipient/domain/recipient_paths.dart';
import 'package:askida/features/recipient/presentation/recipient_providers.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// The code ticket screen. The tag itself is screenshot-safe (shop, item,
/// code, QR and the absolute expiry only); the countdown sits under it.
/// At expiry the tag is replaced by the expired state; the code is never
/// fetched again (see [CodeTiming]).
class CodeScreen extends ConsumerStatefulWidget {
  const new({super.key});

  @override
  ConsumerState<CodeScreen> createState() => _CodeScreenState();
}

class _CodeScreenState extends ConsumerState<CodeScreen> {
  Timer? _ticker;

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  /// Ticks once a second while a valid code is on screen, and only then.
  void _ensureTicking() {
    _ticker ??= Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  void _stopTicking() {
    _ticker?.cancel();
    _ticker = null;
  }

  Future<void> _showToMerchant(ActiveCode code) => Navigator.of(
    context,
    rootNavigator: true,
  ).push(FullBrightnessCodeView.route(code));

  void _backToShop(ActiveCode code) {
    ref.read(activeCodeProvider.notifier).clear();
    context.go(RecipientPaths.shop(code.shopSlug));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final c = AskidaColors.of(context);
    final active = ref.watch(activeCodeProvider);
    final now = ref.watch(clockProvider)();

    final Widget body;
    if (active == null) {
      _stopTicking();
      body = ListView(
        padding: const EdgeInsets.all(AskidaLayout.screenGutter),
        children: [
          Text(
            l10n.recipientNoCodeTitle,
            key: const ValueKey('recipient-no-code'),
            style: AskidaTypography.title3.copyWith(color: c.text),
          ),
          const SizedBox(height: AskidaSpacing.s2),
          Text(
            l10n.recipientNoCodeBody,
            style: AskidaTypography.body.copyWith(color: c.textMuted),
          ),
          const SizedBox(height: AskidaSpacing.s4),
          FilledButton.tonal(
            onPressed: () => context.go(RecipientPaths.home),
            child: Text(l10n.recipientBackToShops),
          ),
        ],
      );
    } else if (CodeTiming.isExpired(active.expiresAt, now)) {
      _stopTicking();
      body = ListView(
        key: const ValueKey('recipient-code-expired'),
        padding: const EdgeInsets.all(AskidaLayout.screenGutter),
        children: [
          Semantics(
            liveRegion: true,
            child: Text(
              l10n.recipientCodeExpiredTitle,
              style: AskidaTypography.title1.copyWith(color: c.text),
            ),
          ),
          const SizedBox(height: AskidaSpacing.s3),
          Text(
            l10n.recipientCodeExpiredBody,
            style: AskidaTypography.body.copyWith(color: c.text),
          ),
          const SizedBox(height: AskidaSpacing.s6),
          FilledButton(
            key: const ValueKey('recipient-code-back-to-shop'),
            onPressed: () => _backToShop(active),
            child: Text(l10n.recipientBackToShop),
          ),
        ],
      );
    } else {
      _ensureTicking();
      final left = CodeTiming.remaining(active.expiresAt, now);
      final reservation = active.reservation;
      body = ListView(
        key: const ValueKey('recipient-code'),
        padding: const EdgeInsets.symmetric(vertical: AskidaSpacing.s4),
        children: [
          CodeTag(
            shopName: reservation.shop.name,
            itemLine: l10n.recipientItemLine(reservation.item.name),
            code: active.code,
            expiresAt: active.expiresAt,
            validMinutes: CodeTiming.window.inMinutes,
            onShowToMerchant: () => _showToMerchant(active),
          ),
          const SizedBox(height: AskidaSpacing.s4),
          Semantics(
            label: l10n.recipientCountdownLabel(CodeTiming.minutesLeft(left)),
            excludeSemantics: true,
            child: Text(
              l10n.recipientCountdown(CodeTiming.format(left)),
              key: const ValueKey('recipient-countdown'),
              textAlign: TextAlign.center,
              style: AskidaTypography.bodyStrong.copyWith(
                color: c.text,
                fontFeatures: const [
                  FontFeature.tabularFigures(),
                  FontFeature.liningFigures(),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AskidaSpacing.s8,
              AskidaSpacing.s3,
              AskidaSpacing.s8,
              0,
            ),
            child: Text(
              l10n.recipientCodeRules,
              textAlign: TextAlign.center,
              style: AskidaTypography.footnote.copyWith(color: c.textMuted),
            ),
          ),
        ],
      );
    }

    return Scaffold(
      appBar: AppBar(primary: false, title: Text(l10n.recipientCodeTitle)),
      body: body,
    );
  }
}

/// "Kodu esnafa göster": the code and QR on white, as large as the screen
/// allows, with the display at full brightness and kept awake. It closes
/// itself when the code expires and restores the brightness on close.
class FullBrightnessCodeView extends ConsumerStatefulWidget {
  const new({required this.code, super.key});

  final ActiveCode code;

  static Route<void> route(ActiveCode code) => MaterialPageRoute<void>(
    fullscreenDialog: true,
    builder: (context) => FullBrightnessCodeView(code: code),
  );

  @override
  ConsumerState<FullBrightnessCodeView> createState() =>
      _FullBrightnessCodeViewState();
}

class _FullBrightnessCodeViewState
    extends ConsumerState<FullBrightnessCodeView> {
  late final ScreenBrightness _brightness = ref.read(screenBrightnessProvider);
  Timer? _ticker;
  bool _closing = false;

  @override
  void initState() {
    super.initState();
    unawaited(_brightness.setFull(enabled: true));
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) => _checkExpiry());
  }

  void _checkExpiry() {
    if (!mounted || _closing) return;
    final now = ref.read(clockProvider)();
    if (CodeTiming.isExpired(widget.code.expiresAt, now)) {
      _closing = true;
      Navigator.of(context).maybePop();
    }
  }

  @override
  void dispose() {
    _ticker?.cancel();
    unawaited(_brightness.setFull(enabled: false));
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final code = widget.code;
    const ink = AskidaColors.qrInk;
    return Scaffold(
      key: const ValueKey('recipient-full-brightness'),
      backgroundColor: AskidaColors.qrPaper,
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final side = (constraints.maxWidth - 2 * AskidaSpacing.s6).clamp(
              160.0,
              360.0,
            );
            return ListView(
              padding: const EdgeInsets.all(AskidaSpacing.s6),
              children: [
                Text(
                  l10n.recipientItemLine(code.reservation.item.name),
                  textAlign: TextAlign.center,
                  style: AskidaTypography.title3.copyWith(color: ink),
                ),
                const SizedBox(height: AskidaSpacing.s4),
                Semantics(
                  label: l10n.codeLabel(code.code.split('').join(' ')),
                  excludeSemantics: true,
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      groupCode(code.code),
                      key: const ValueKey('recipient-full-code'),
                      style: AskidaTypography.code.copyWith(
                        color: ink,
                        fontSize: 44,
                        height: 1.2,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: AskidaSpacing.s6),
                Center(
                  child: QrPanel(data: code.code, targetSize: side),
                ),
                const SizedBox(height: AskidaSpacing.s6),
                Text(
                  l10n.codeValidUntil(
                    clockTime(code.expiresAt),
                    turkishDativeSuffix(code.expiresAt),
                  ),
                  textAlign: TextAlign.center,
                  style: AskidaTypography.numeral.copyWith(color: ink),
                ),
                const SizedBox(height: AskidaSpacing.s6),
                Center(
                  child: TextButton(
                    key: const ValueKey('recipient-full-close'),
                    style: TextButton.styleFrom(foregroundColor: ink),
                    onPressed: () => Navigator.of(context).maybePop(),
                    child: Text(l10n.recipientFullClose),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
