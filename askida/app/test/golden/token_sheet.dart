import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/typography.dart';
import 'package:flutter/material.dart';

/// Every colour role and type style of the current theme on one sheet, for
/// the golden check of the theme mapping.
class TokenSheet extends StatelessWidget {
  const new({super.key});

  @override
  Widget build(BuildContext context) {
    final c = AskidaColors.of(context);
    final roles = c.byToken.entries.toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: AskidaSpacing.s2,
          runSpacing: AskidaSpacing.s2,
          children: [
            for (final role in roles)
              SizedBox(
                width: 158,
                child: Row(
                  children: [
                    Container(
                      width: 28,
                      height: 28,
                      decoration: BoxDecoration(
                        color: role.value,
                        border: Border.all(color: c.border),
                        borderRadius: const BorderRadius.all(
                          Radius.circular(AskidaRadius.tag),
                        ),
                      ),
                    ),
                    const SizedBox(width: AskidaSpacing.s2),
                    Expanded(
                      child: Text(
                        role.key,
                        style: AskidaTypography.footnote.copyWith(
                          color: c.text,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
        const SizedBox(height: AskidaSpacing.s6),
        for (final MapEntry(key: name, value: style)
            in AskidaTypography.byToken.entries)
          Text(
            name == 'code'
                ? 'K7M2 QX9R'
                : name.startsWith('numeral')
                ? '₺45,00 12'
                : '$name Çğİıöşü',
            style: style.copyWith(color: c.text),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        const SizedBox(height: AskidaSpacing.s6),
        Wrap(
          spacing: AskidaSpacing.s2,
          runSpacing: AskidaSpacing.s2,
          children: [
            FilledButton(onPressed: () {}, child: const Text('Askıdan al')),
            FilledButton.tonal(onPressed: () {}, child: const Text('İlçe seç')),
            TextButton(onPressed: () {}, child: const Text('Esnaf mısınız?')),
          ],
        ),
        const SizedBox(height: AskidaSpacing.s4),
        const TextField(decoration: InputDecoration(labelText: 'İlçe')),
        const SizedBox(height: AskidaSpacing.s4),
        const Card(
          child: SizedBox(height: 56, child: Center(child: Text('Kart'))),
        ),
      ],
    );
  }
}
