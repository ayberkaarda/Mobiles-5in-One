import 'dart:math' as math;

import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/typography.dart';
import 'package:askida/design/widgets/askida_tag.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

/// Splits a one-time code into groups of four: `K7M2QX9R` -> `K7M2 QX9R`.
/// The code is shown exactly as issued; no case change.
String groupCode(String code) {
  final compact = code.replaceAll(' ', '');
  final groups = <String>[
    for (var i = 0; i < compact.length; i += 4)
      compact.substring(i, math.min(i + 4, compact.length)),
  ];
  return groups.join(' ');
}

/// `HH:mm`, 24 hour clock.
String clockTime(DateTime time) =>
    '${time.hour.toString().padLeft(2, '0')}:'
    '${time.minute.toString().padLeft(2, '0')}';

/// Turkish dative ending for a clock time as read aloud: the last spoken
/// number decides (09:41 "kırk bir" -> `e`, 09:30 "otuz" -> `a`,
/// 10:00 "on" -> `a`, 12:00 "on iki" -> `ye`).
String turkishDativeSuffix(DateTime time) {
  final n = time.minute != 0 ? time.minute : time.hour;
  if (n == 0) return 'a'; // sıfır
  const units = {
    1: 'e', // bir
    2: 'ye', // iki
    3: 'e', // üç
    4: 'e', // dört
    5: 'e', // beş
    6: 'ya', // altı
    7: 'ye', // yedi
    8: 'e', // sekiz
    9: 'a', // dokuz
  };
  const tens = {
    1: 'a', // on
    2: 'ye', // yirmi
    3: 'a', // otuz
    4: 'a', // kırk
    5: 'ye', // elli
  };
  final unit = n % 10;
  return unit != 0 ? units[unit]! : tens[n ~/ 10]!;
}

/// The code ticket (askı fişi): one large tag hanging from one rail, the
/// code on it.
///
/// Screenshot-safe by construction: it takes no map, distance, anonymous id
/// or name, and shows the expiry as an absolute time instead of a counter.
class CodeTag extends StatefulWidget {
  const new({
    required this.shopName,
    required this.itemLine,
    required this.code,
    required this.expiresAt,
    this.validMinutes = 10,
    this.qrData,
    this.onShowToMerchant,
    super.key,
  });

  final String shopName;

  /// What the code is for ("1 ekmek").
  final String itemLine;

  /// The one-time code as issued (8 characters).
  final String code;

  final DateTime expiresAt;
  final int validMinutes;

  /// QR payload; defaults to [code].
  final String? qrData;

  /// When set, the secondary "Kodu esnafa göster" button is shown.
  final VoidCallback? onShowToMerchant;

  /// Horizontal inset of the tag from both edges.
  static const double inset = 32;
  static const double holeRadius = 6;
  static const double holeCenterY = 20;
  static const double tieLength = 16;

  @override
  State<CodeTag> createState() => _CodeTagState();
}

class _CodeTagState extends State<CodeTag> with SingleTickerProviderStateMixin {
  late final AnimationController _swing = AnimationController(
    vsync: this,
    duration: AskidaMotion.settle,
  );
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    // One damped swing, once; none with reduced motion.
    if (!AskidaMotion.reduced(context)) _swing.forward();
  }

  @override
  void dispose() {
    _swing.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = AskidaColors.of(context);
    final l10n = context.l10n;
    final time = clockTime(widget.expiresAt);
    final grouped = groupCode(widget.code);

    final tagContent = Padding(
      padding: const EdgeInsets.fromLTRB(
        AskidaSpacing.s6,
        CodeTag.holeCenterY + CodeTag.holeRadius + AskidaSpacing.s4,
        AskidaSpacing.s6,
        AskidaSpacing.s6,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Wordmark placeholder until the outlined wordmark is available.
          Text(
            'askıda',
            style: TextStyle(
              fontFamily: AskidaTypography.displayFamily,
              fontWeight: FontWeight.w600,
              fontSize: 20,
              height: 1.2,
              color: c.text,
            ),
          ),
          const SizedBox(height: AskidaSpacing.s4),
          Text(
            widget.shopName,
            style: AskidaTypography.title2.copyWith(color: c.text),
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: AskidaSpacing.s1),
          Text(
            widget.itemLine,
            style: AskidaTypography.bodyStrong.copyWith(color: c.text),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: AskidaSpacing.s4),
          Semantics(
            label: l10n.codeLabel(widget.code.split('').join(' ')),
            excludeSemantics: true,
            child: FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(
                grouped,
                key: const ValueKey('code-tag-code'),
                style: AskidaTypography.code.copyWith(color: c.text),
                maxLines: 1,
              ),
            ),
          ),
          const SizedBox(height: AskidaSpacing.s4),
          QrPanel(data: widget.qrData ?? widget.code),
          const SizedBox(height: AskidaSpacing.s4),
          Text(
            l10n.codeValidUntil(time, turkishDativeSuffix(widget.expiresAt)),
            style: AskidaTypography.numeral.copyWith(color: c.text),
            textAlign: TextAlign.center,
          ),
          Text(
            l10n.codeValidFor(widget.validMinutes),
            style: AskidaTypography.footnote.copyWith(color: c.textMuted),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );

    final tag = CustomPaint(
      painter: TagPainter(
        fill: c.surfaceRaised,
        borderColor: c.borderStrong,
        radius: AskidaRadius.card,
        holeRadius: CodeTag.holeRadius,
        holeCenterY: CodeTag.holeCenterY,
      ),
      child: SizedBox(width: double.infinity, child: tagContent),
    );

    final onShow = widget.onShowToMerchant;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(height: AskidaStroke.rail, color: c.text),
        Container(
          width: AskidaStroke.rail,
          height: CodeTag.tieLength,
          color: c.text,
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: CodeTag.inset),
          child: AnimatedBuilder(
            animation: _swing,
            builder: (context, child) {
              final t = _swing.value;
              // ±3° about the hole, decaying to rest.
              final angle =
                  3 * math.pi / 180 * math.sin(2 * math.pi * t) * (1 - t);
              return Transform.rotate(
                angle: angle,
                alignment: Alignment.topCenter,
                origin: const Offset(0, CodeTag.holeCenterY),
                child: child,
              );
            },
            child: tag,
          ),
        ),
        if (onShow != null) ...[
          const SizedBox(height: AskidaSpacing.s6),
          FilledButton.tonal(
            onPressed: onShow,
            child: Text(l10n.codeShowToMerchant),
          ),
        ],
      ],
    );
  }
}

/// QR code that is always ink on white, in both schemes, with a quiet zone
/// of four modules. Module size is a whole number of logical pixels.
class QrPanel extends StatelessWidget {
  const new({required this.data, this.targetSize = 176, super.key});

  final String data;
  final double targetSize;

  static const int quietModules = 4;

  @override
  Widget build(BuildContext context) {
    final qr = QrCode.fromData(
      data: data,
      errorCorrectLevel: QrErrorCorrectLevel.M,
    );
    final modules = qr.moduleCount;
    final double module = math.max(
      2,
      (targetSize / (modules + 2 * quietModules)).floorToDouble(),
    );
    final side = module * (modules + 2 * quietModules);
    return ExcludeSemantics(
      child: Container(
        key: const ValueKey('code-tag-qr'),
        width: side,
        height: side,
        color: AskidaColors.qrPaper,
        padding: EdgeInsets.all(module * quietModules),
        child: CustomPaint(
          size: Size.square(module * modules),
          painter: QrPainter.withQr(
            qr: qr,
            gapless: true,
            eyeStyle: const QrEyeStyle(
              eyeShape: QrEyeShape.square,
              color: AskidaColors.qrInk,
            ),
            dataModuleStyle: const QrDataModuleStyle(
              dataModuleShape: QrDataModuleShape.square,
              color: AskidaColors.qrInk,
            ),
          ),
        ),
      ),
    );
  }
}
