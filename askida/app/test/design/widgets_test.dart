import 'package:askida/design/widgets/askida_tag.dart';
import 'package:askida/design/widgets/code_tag.dart';
import 'package:askida/design/widgets/mode_switcher.dart';
import 'package:askida/design/widgets/rail_counter.dart';
import 'package:askida/design/widgets/shop_card.dart';
import 'package:askida/routing/app_mode.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../helpers/design_samples.dart';
import '../helpers/pump_design.dart';

void main() {
  group('every widget renders without overflow', () {
    for (final MapEntry(key: name, value: widget) in designSamples().entries) {
      for (final brightness in Brightness.values) {
        for (final scale in [1.0, 1.3]) {
          testWidgets('$name ${brightness.name} x$scale', (tester) async {
            await tester.pumpDesign(
              widget,
              brightness: brightness,
              textScale: scale,
            );
            expect(tester.takeException(), isNull);
          });
        }
      }
    }

    testWidgets('narrow screen at x1.3', (tester) async {
      for (final widget in designSamples().values) {
        await tester.pumpDesign(
          widget,
          textScale: 1.3,
          size: const Size(320, 640),
        );
        expect(tester.takeException(), isNull);
      }
    });
  });

  group('AskidaTag', () {
    test('the hole is an even-odd cutout', () {
      const size = Size(12, 16);
      final r = TagGeometry.holeRadius(size.width);
      final cy = TagGeometry.holeCenterY(size.width);
      final path = TagGeometry.path(
        size,
        radius: TagGeometry.cornerRadius(size.width),
        holeRadius: r,
        holeCenterY: cy,
      );
      expect(path.fillType, PathFillType.evenOdd);
      expect(path.contains(Offset(6, cy)), isFalse);
      expect(path.contains(const Offset(6, 12)), isTrue);
      // Mark proportions: hole r 1.5 centred 3.5 below the tag top.
      expect(r, 1.5);
      expect(cy, 3.5);
    });

    testWidgets('accent tag uses the accent fill', (tester) async {
      await tester.pumpDesign(const AskidaTag());
      final paint = tester.widget<CustomPaint>(
        find
            .descendant(
              of: find.byType(AskidaTag),
              matching: find.byType(CustomPaint),
            )
            .first,
      );
      expect((paint.painter! as TagPainter).fill, const Color(0xFFC8763A));
    });
  });

  group('RailCounter', () {
    Finder tags() => find.byWidgetPredicate(
      (w) =>
          w.key is ValueKey<String> &&
          (w.key! as ValueKey<String>).value.startsWith('rail-tag-') &&
          (w.key! as ValueKey<String>).value != 'rail-tag-more',
    );

    testWidgets('caps at 12 tags and shows +n for the rest', (tester) async {
      await tester.pumpDesign(
        const RailCounter(count: 30, lead: 'Bugün', tail: 'çorba askıda'),
      );
      expect(tags(), findsNWidgets(12));
      expect(find.text('+18'), findsOneWidget);
      expect(find.textContaining('30'), findsOneWidget);
    });

    testWidgets('exactly 12 shows no +n tag', (tester) async {
      await tester.pumpDesign(
        const RailCounter(count: 12, lead: 'Bugün', tail: 'çorba askıda'),
      );
      expect(tags(), findsNWidgets(12));
      expect(find.byKey(const ValueKey('rail-tag-more')), findsNothing);
    });

    testWidgets('zero shows an empty rail', (tester) async {
      await tester.pumpDesign(
        const RailCounter(count: 0, lead: 'Bugün', tail: 'çorba askıda'),
      );
      expect(tags(), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('sample values carry the sample label', (tester) async {
      await tester.pumpDesign(
        const RailCounter(
          count: 12,
          lead: 'Bugün',
          tail: 'çorba askıda',
          sampleLabel: 'ÖRNEK',
        ),
      );
      expect(find.text('ÖRNEK'), findsOneWidget);
    });

    testWidgets('a new tag drops in, but not with reduced motion', (
      tester,
    ) async {
      Future<void> grow({required bool reduced}) async {
        await tester.pumpDesign(
          const RailCounter(count: 2, lead: 'Bugün', tail: 'çorba askıda'),
          disableAnimations: reduced,
        );
        await tester.pumpDesign(
          const RailCounter(count: 3, lead: 'Bugün', tail: 'çorba askıda'),
          disableAnimations: reduced,
          settle: false,
        );
      }

      final dropIn = find.byType(TweenAnimationBuilder<double>);
      await grow(reduced: false);
      expect(dropIn, findsOneWidget);
      await tester.pumpAndSettle();

      await grow(reduced: true);
      expect(dropIn, findsNothing);
      expect(tags(), findsNWidgets(3));
    });
  });

  group('CodeTag', () {
    Widget codeTag() => CodeTag(
      shopName: '[ÖRNEK] Köşe Fırını',
      itemLine: '1 ekmek',
      code: sampleCode,
      expiresAt: sampleExpiry,
    );

    testWidgets('shows the code in groups of four and the expiry', (
      tester,
    ) async {
      await tester.pumpDesign(codeTag());
      expect(find.text('K7M2 QX9R'), findsOneWidget);
      expect(find.text("09:41'e kadar"), findsOneWidget);
      expect(find.text('10 dakika geçerli'), findsOneWidget);
      expect(find.text('askıda'), findsOneWidget);
    });

    testWidgets('never renders a distance, map or person', (tester) async {
      await tester.pumpDesign(codeTag());
      final texts = tester
          .widgetList<Text>(find.byType(Text))
          .map((t) => t.data ?? t.textSpan?.toPlainText() ?? '')
          .toList();
      final distance = RegExp(r'\d\s?(m|km)\b');
      for (final text in texts) {
        expect(distance.hasMatch(text), isFalse, reason: text);
      }
      expect(texts.toSet(), {
        'askıda',
        '[ÖRNEK] Köşe Fırını',
        '1 ekmek',
        'K7M2 QX9R',
        "09:41'e kadar",
        '10 dakika geçerli',
      });
      expect(find.byType(ShopCard), findsNothing);
    });

    testWidgets('the QR panel is ink on white with a 4-module quiet zone', (
      tester,
    ) async {
      for (final brightness in Brightness.values) {
        await tester.pumpDesign(codeTag(), brightness: brightness);
        final panel = tester.widget<Container>(
          find.byKey(const ValueKey('code-tag-qr')),
        );
        expect(panel.color, const Color(0xFFFFFFFF));
        final size = tester.getSize(find.byKey(const ValueKey('code-tag-qr')));
        final padding = (panel.padding! as EdgeInsets).left;
        // Version 1 at level M: 21 modules + 2 x 4 quiet modules.
        final module = size.width / (21 + 8);
        expect(padding, module * 4);
        expect(module, module.roundToDouble());
      }
    });

    testWidgets('swings once, and not at all with reduced motion', (
      tester,
    ) async {
      await tester.pumpDesign(codeTag(), settle: false);
      expect(tester.hasRunningAnimations, isTrue);
      await tester.pumpAndSettle();

      await tester.pumpWidget(const SizedBox());
      await tester.pumpDesign(
        codeTag(),
        disableAnimations: true,
        settle: false,
      );
      await tester.pump();
      expect(tester.hasRunningAnimations, isFalse);
    });

    test('Turkish dative suffix follows the last spoken number', () {
      String s(int h, int m) => turkishDativeSuffix(DateTime(2026, 1, 1, h, m));
      expect(s(9, 41), 'e');
      expect(s(9, 30), 'a');
      expect(s(9, 46), 'ya');
      expect(s(9, 42), 'ye');
      expect(s(9, 50), 'ye');
      expect(s(10, 0), 'a');
      expect(s(12, 0), 'ye');
      expect(s(0, 0), 'a');
      expect(s(14, 9), 'a');
      expect(groupCode(sampleCode), 'K7M2 QX9R');
      expect(clockTime(DateTime(2026, 1, 1, 7, 5)), '07:05');
    });
  });

  group('ShopCard', () {
    testWidgets('count, caption, verified and sample chip', (tester) async {
      await tester.pumpDesign(
        const ShopCard(
          name: '[ÖRNEK] Köşe Fırını',
          district: 'Şişli',
          distanceMeters: 450,
          category: ShopCategory.ekmek,
          availableCount: 12,
          verified: true,
          isSample: true,
        ),
      );
      expect(find.text('12'), findsOneWidget);
      expect(find.text('askıda'), findsOneWidget);
      expect(find.text('Şişli · 450 m'), findsOneWidget);
      expect(find.text('Doğrulanmış'), findsOneWidget);
      expect(find.text('ÖRNEK'), findsOneWidget);
      final tag = tester.widget<AskidaTag>(find.byType(AskidaTag));
      expect(tag.tone, AskidaTagTone.accent);
    });

    testWidgets('zero shows a dash and a quiet tag', (tester) async {
      await tester.pumpDesign(
        const ShopCard(
          name: 'Mahalle Lokantası',
          district: 'Kadıköy',
          distanceMeters: 1240,
          category: ShopCategory.corba,
          availableCount: 0,
        ),
      );
      expect(find.text('—'), findsOneWidget);
      expect(find.text('Kadıköy · 1,2 km'), findsOneWidget);
      expect(find.text('ÖRNEK'), findsNothing);
      expect(find.text('Doğrulanmış'), findsNothing);
      final tag = tester.widget<AskidaTag>(find.byType(AskidaTag));
      expect(tag.tone, AskidaTagTone.secondary);
    });
  });

  group('ModeSwitcher', () {
    testWidgets('order is recipient, donor, merchant; recipient default', (
      tester,
    ) async {
      var selected = AppMode.initial;
      await tester.pumpDesign(
        StatefulBuilder(
          builder: (context, setState) => ModeSwitcher(
            selected: selected,
            onChanged: (mode) => setState(() => selected = mode),
          ),
        ),
      );
      expect(AppMode.initial, AppMode.recipient);
      expect(AppMode.values, [
        AppMode.recipient,
        AppMode.donor,
        AppMode.merchant,
      ]);
      final labels = ['Askıdan al', 'Askıya bırak', 'Esnaf'];
      final xs = [for (final l in labels) tester.getCenter(find.text(l)).dx];
      expect(xs[0], lessThan(xs[1]));
      expect(xs[1], lessThan(xs[2]));

      final button = tester.widget<SegmentedButton<AppMode>>(
        find.byType(SegmentedButton<AppMode>),
      );
      expect(button.selected, {AppMode.recipient});
      expect(button.showSelectedIcon, isFalse);

      await tester.tap(find.text('Esnaf'));
      await tester.pumpAndSettle();
      expect(selected, AppMode.merchant);
    });
  });
}
