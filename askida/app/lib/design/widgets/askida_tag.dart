import 'dart:math' as math;

import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:flutter/material.dart';

/// Proportions of the tag from the rail-tag mark: on a 12 unit wide tag the
/// hole has radius 1.5 and its top sits 2 units below the tag top.
abstract final class TagGeometry {
  static double holeRadius(double width) =>
      (width * 0.125).clamp(1.5, 6).toDouble();

  static double holeCenterY(double width) =>
      math.min(width / 6, 10) + holeRadius(width);

  /// Corner radius: the tag token, never more than a quarter of the width.
  static double cornerRadius(double width) =>
      math.min(AskidaRadius.tag, width / 4);

  /// The tag outline with the hole cut out (even-odd), so whatever is behind
  /// the tag shows through the hole.
  static Path path(
    Size size, {
    required double radius,
    required double holeRadius,
    required double holeCenterY,
  }) => Path()
    ..fillType = PathFillType.evenOdd
    ..addRRect(
      RRect.fromRectAndRadius(Offset.zero & size, Radius.circular(radius)),
    )
    ..addOval(
      Rect.fromCircle(
        center: Offset(size.width / 2, holeCenterY),
        radius: holeRadius,
      ),
    );
}

/// Paints a flat tag with a punched hole. Used by [AskidaTag] and the code
/// tag.
class TagPainter extends CustomPainter {
  new({
    required this.fill,
    required this.radius,
    required this.holeRadius,
    required this.holeCenterY,
    this.borderColor,
    this.borderWidth = AskidaStroke.border,
  });

  final Color fill;
  final double radius;
  final double holeRadius;
  final double holeCenterY;
  final Color? borderColor;
  final double borderWidth;

  @override
  void paint(Canvas canvas, Size size) {
    final path = TagGeometry.path(
      size,
      radius: radius,
      holeRadius: holeRadius,
      holeCenterY: holeCenterY,
    );
    canvas.drawPath(path, Paint()..color = fill);
    final border = borderColor;
    if (border != null) {
      final half = borderWidth / 2;
      final inner = TagGeometry.path(
        Size(size.width - borderWidth, size.height - borderWidth),
        radius: math.max(0, radius - half),
        holeRadius: holeRadius + half,
        holeCenterY: holeCenterY - half,
      ).shift(Offset(half, half));
      canvas.drawPath(
        inner,
        Paint()
          ..color = border
          ..style = PaintingStyle.stroke
          ..strokeWidth = borderWidth,
      );
    }
  }

  @override
  bool shouldRepaint(TagPainter oldDelegate) =>
      fill != oldDelegate.fill ||
      radius != oldDelegate.radius ||
      holeRadius != oldDelegate.holeRadius ||
      holeCenterY != oldDelegate.holeCenterY ||
      borderColor != oldDelegate.borderColor ||
      borderWidth != oldDelegate.borderWidth;
}

/// Fill of a tag. `accent` means "something is hanging here"; `surface` is
/// the tag used on the sunken band and for blank tags; `secondary` is the
/// quiet tag (nothing on the rail, `+n`).
enum AskidaTagTone { accent, surface, secondary }

/// The unit of the system: a flat rounded tag with a punched hole.
///
/// [width] and [height] are the tag size; with a [child] they are minimums
/// and the tag grows to fit the child under the hole.
class AskidaTag extends StatelessWidget {
  const new({
    this.width = 12,
    this.height = 16,
    this.tone = AskidaTagTone.accent,
    this.child,
    this.semanticLabel,
    super.key,
  });

  final double width;
  final double height;
  final AskidaTagTone tone;
  final Widget? child;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final c = AskidaColors.of(context);
    final (fill, foreground, border) = switch (tone) {
      AskidaTagTone.accent => (c.accent, c.onAccent, null),
      AskidaTagTone.surface => (c.surface, c.text, c.border),
      AskidaTagTone.secondary => (c.secondary, c.onSecondary, null),
    };
    final holeRadius = TagGeometry.holeRadius(width);
    final holeCenterY = TagGeometry.holeCenterY(width);
    final content = child;

    final tag = CustomPaint(
      painter: TagPainter(
        fill: fill,
        radius: TagGeometry.cornerRadius(width),
        holeRadius: holeRadius,
        holeCenterY: holeCenterY,
        borderColor: border,
      ),
      child: ConstrainedBox(
        constraints: BoxConstraints(minWidth: width, minHeight: height),
        child: content == null
            ? null
            : Padding(
                padding: EdgeInsets.fromLTRB(
                  AskidaSpacing.s1,
                  holeCenterY + holeRadius + 2,
                  AskidaSpacing.s1,
                  AskidaSpacing.s1,
                ),
                child: Center(
                  widthFactor: 1,
                  heightFactor: 1,
                  child: IconTheme.merge(
                    data: IconThemeData(color: foreground),
                    child: DefaultTextStyle.merge(
                      style: TextStyle(color: foreground),
                      child: content,
                    ),
                  ),
                ),
              ),
      ),
    );

    final label = semanticLabel;
    return label == null
        ? ExcludeSemantics(child: tag)
        : Semantics(label: label, excludeSemantics: true, child: tag);
  }
}
