import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/widgets/askida_tag.dart';
import 'package:flutter/material.dart';

/// Graphic, title and explanation used when a list has nothing to show.
class EmptyState extends StatelessWidget {
  const new({
    required this.title,
    required this.body,
    this.graphic = const EmptyRail(),
    super.key,
  });

  final Widget? graphic;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final art = graphic;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(AskidaSpacing.s8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (art != null) ...[art, const SizedBox(height: AskidaSpacing.s6)],
            Text(
              title,
              style: theme.textTheme.headlineSmall,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AskidaSpacing.s3),
            Text(
              body,
              style: theme.textTheme.bodyLarge?.copyWith(
                color: AskidaColors.of(context).textMuted,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

/// A short rail with one blank tag: nothing is hanging yet.
class EmptyRail extends StatelessWidget {
  const new({super.key});

  @override
  Widget build(BuildContext context) {
    final c = AskidaColors.of(context);
    return ExcludeSemantics(
      child: SizedBox(
        width: 96,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(height: AskidaStroke.rail, color: c.text),
            Container(width: AskidaStroke.rail, height: 6, color: c.text),
            const AskidaTag(width: 32, height: 40, tone: AskidaTagTone.surface),
          ],
        ),
      ),
    );
  }
}
