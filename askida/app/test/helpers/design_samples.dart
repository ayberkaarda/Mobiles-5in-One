import 'package:askida/design/widgets/askida_tag.dart';
import 'package:askida/design/widgets/code_tag.dart';
import 'package:askida/design/widgets/mode_switcher.dart';
import 'package:askida/design/widgets/rail_counter.dart';
import 'package:askida/design/widgets/shop_card.dart';
import 'package:askida/routing/app_mode.dart';
import 'package:flutter/material.dart';

/// Sample one-time code used by tests (8 upper-case alphanumerics).
const sampleCode = 'K7M2QX9R';

final sampleExpiry = DateTime(2026, 10, 4, 9, 41);

/// The five design widgets with sample data, keyed by name.
Map<String, Widget> designSamples() => {
  'askida_tag': const Wrap(
    spacing: 16,
    runSpacing: 16,
    crossAxisAlignment: WrapCrossAlignment.end,
    children: [
      AskidaTag(),
      AskidaTag(tone: AskidaTagTone.surface),
      AskidaTag(tone: AskidaTagTone.secondary),
      AskidaTag(
        width: 40,
        height: 48,
        child: Icon(Icons.soup_kitchen_outlined, size: 20),
      ),
      AskidaTag(
        width: 40,
        height: 48,
        tone: AskidaTagTone.secondary,
        child: Icon(Icons.bakery_dining_outlined, size: 20),
      ),
      AskidaTag(width: 96, height: 120, tone: AskidaTagTone.surface),
    ],
  ),
  'rail_counter': const Column(
    children: [
      RailCounter(
        count: 12,
        lead: 'Bugün',
        tail: 'çorba askıda',
        sampleLabel: 'ÖRNEK',
      ),
      SizedBox(height: 16),
      RailCounter(count: 38, lead: 'Bugün', tail: 'ekmek askıda'),
      SizedBox(height: 16),
      RailCounter(count: 3, lead: 'Bugün', tail: 'defter askıda'),
    ],
  ),
  'code_tag': CodeTag(
    shopName: '[ÖRNEK] Köşe Fırını',
    itemLine: '1 ekmek',
    code: sampleCode,
    expiresAt: sampleExpiry,
    onShowToMerchant: () {},
  ),
  'shop_card': const Column(
    children: [
      ShopCard(
        name: '[ÖRNEK] Köşe Fırını',
        district: 'Şişli',
        distanceMeters: 450,
        category: ShopCategory.ekmek,
        availableCount: 12,
        verified: true,
        isSample: true,
      ),
      SizedBox(height: 12),
      ShopCard(
        name: '[ÖRNEK] Mahalle Lokantası',
        district: 'Kadıköy',
        distanceMeters: 1240,
        category: ShopCategory.corba,
        availableCount: 0,
        isSample: true,
      ),
    ],
  ),
  'mode_switcher': ModeSwitcher(selected: AppMode.recipient, onChanged: (_) {}),
};
