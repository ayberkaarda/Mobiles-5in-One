import 'dart:math' as math;

import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/typography.dart';
import 'package:askida/design/widgets/askida_tag.dart';
import 'package:askida/design/widgets/sample_chip.dart';
import 'package:flutter/material.dart';

/// "Bugün 12 çorba askıda": a 2 px rail with one accent tag per item (at
/// most [maxTags], then one secondary `+n` tag) and the sentence underneath.
///
/// Counts are always counts of items. There is no target, bar or
/// percentage. The counter sits on `surface`, never on the sunken surface.
class RailCounter extends StatefulWidget {
  const new({
    required this.count,
    required this.lead,
    required this.tail,
    this.sampleLabel,
    super.key,
  }) : assert(count >= 0, 'count is a number of items');

  /// Number of items on the rail.
  final int count;

  /// Words before the number ("Bugün").
  final String lead;

  /// Words after the number ("çorba askıda").
  final String tail;

  /// When set, the value is sample data and carries this label (`ÖRNEK`).
  final String? sampleLabel;

  static const int maxTags = 12;
  static const double tagWidth = 12;
  static const double tagHeight = 16;
  static const double pitch = 20;
  static const double tieLength = 4;

  @override
  State<RailCounter> createState() => _RailCounterState();
}

class _RailCounterState extends State<RailCounter> {
  /// Tags at or above this index arrived after the first build and drop in.
  late int _settled = widget.count;

  @override
  void didUpdateWidget(RailCounter oldWidget) {
    super.didUpdateWidget(oldWidget);
    _settled = math.min(oldWidget.count, widget.count);
  }

  @override
  Widget build(BuildContext context) {
    final c = AskidaColors.of(context);
    final sample = widget.sampleLabel;
    final sentence = '${widget.lead} ${widget.count} ${widget.tail}';
    return DecoratedBox(
      decoration: BoxDecoration(
        color: c.surface,
        border: Border.all(color: c.border),
        borderRadius: const BorderRadius.all(
          Radius.circular(AskidaRadius.card),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(AskidaSpacing.s4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (sample != null) ...[
              SampleChip(label: sample),
              const SizedBox(height: AskidaSpacing.s3),
            ],
            ExcludeSemantics(
              child: _Rail(count: widget.count, settled: _settled),
            ),
            const SizedBox(height: AskidaSpacing.s4),
            Semantics(
              label: sample == null ? sentence : '$sentence, $sample',
              excludeSemantics: true,
              child: Text.rich(
                TextSpan(
                  style: AskidaTypography.title1.copyWith(color: c.text),
                  children: [
                    TextSpan(text: '${widget.lead} '),
                    TextSpan(
                      text: '${widget.count}',
                      style: AskidaTypography.numeralXL.copyWith(color: c.text),
                    ),
                    TextSpan(text: ' ${widget.tail}'),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Rail extends StatelessWidget {
  const new({required this.count, required this.settled});

  final int count;
  final int settled;

  @override
  Widget build(BuildContext context) {
    final c = AskidaColors.of(context);
    final scaler = MediaQuery.textScalerOf(context);
    return LayoutBuilder(
      builder: (context, constraints) {
        var shown = math.min(count, RailCounter.maxTags);
        var overflow = count - shown;
        double plusWidth(int n) {
          final painter = TextPainter(
            text: TextSpan(text: '+$n', style: AskidaTypography.caption),
            textDirection: TextDirection.ltr,
            textScaler: scaler,
          )..layout();
          final width = painter.width + 2 * AskidaSpacing.s1 + 2;
          painter.dispose();
          return math.max(width, RailCounter.pitch);
        }

        // On a narrow container fewer tags hang and the rest move into +n.
        const inset = AskidaSpacing.s2;
        while (shown > 0) {
          final extra = overflow > 0
              ? plusWidth(overflow) + AskidaSpacing.s2
              : 0.0;
          if (inset + shown * RailCounter.pitch + extra <=
              constraints.maxWidth) {
            break;
          }
          shown--;
          overflow++;
        }

        Widget hanging(Widget tag, {required bool drop}) => _DropIn(
          animate: drop,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: AskidaStroke.rail,
                height: RailCounter.tieLength,
                color: c.text,
              ),
              tag,
            ],
          ),
        );

        return Stack(
          children: [
            Positioned(
              left: 0,
              right: 0,
              top: 0,
              child: Container(height: AskidaStroke.rail, color: c.text),
            ),
            Padding(
              padding: const EdgeInsets.only(
                left: inset,
                top: AskidaStroke.rail,
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (var i = 0; i < shown; i++)
                    Padding(
                      key: ValueKey('rail-tag-$i'),
                      padding: const EdgeInsets.only(
                        right: RailCounter.pitch - RailCounter.tagWidth,
                      ),
                      child: hanging(const AskidaTag(), drop: i >= settled),
                    ),
                  if (overflow > 0)
                    hanging(
                      AskidaTag(
                        key: const ValueKey('rail-tag-more'),
                        width: RailCounter.pitch,
                        tone: AskidaTagTone.secondary,
                        child: Text(
                          '+$overflow',
                          style: AskidaTypography.caption,
                          maxLines: 1,
                        ),
                      ),
                      drop: false,
                    ),
                  if (shown == 0 && overflow == 0)
                    const SizedBox(
                      height: RailCounter.tieLength + RailCounter.tagHeight,
                    ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}

/// A new tag drops onto the rail: −8 → 0 and a fade over `enter`. With
/// reduced motion the duration is zero and the tag renders in place.
class _DropIn extends StatelessWidget {
  const new({required this.animate, required this.child});

  final bool animate;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (!animate || AskidaMotion.reduced(context)) return child;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: AskidaMotion.enter,
      curve: AskidaMotion.easeIn,
      builder: (context, t, child) => Opacity(
        opacity: t,
        child: Transform.translate(
          offset: Offset(0, -8 * (1 - t)),
          child: child,
        ),
      ),
      child: child,
    );
  }
}
