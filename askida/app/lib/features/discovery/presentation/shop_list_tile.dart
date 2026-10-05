import 'package:askida/data/models/shop.dart';
import 'package:askida/design/widgets/shop_card.dart';
import 'package:flutter/material.dart';

/// Design category shown for a shop type (the glyph on the tag).
ShopCategory categoryForShopType(ShopType type) => switch (type) {
  ShopType.bakery => ShopCategory.ekmek,
  ShopType.restaurant => ShopCategory.corba,
  ShopType.cafe => ShopCategory.yemek,
  ShopType.stationery => ShopCategory.kirtasiye,
  ShopType.grocery || ShopType.other => ShopCategory.diger,
};

/// A row of the shop list: the design [ShopCard] filled from a
/// [ShopSummary]. Listed shops are verified by definition (the directory
/// only returns verified shops).
class ShopListTile extends StatelessWidget {
  const new({required this.shop, this.onTap, super.key});

  final ShopSummary shop;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => ShopCard(
    key: ValueKey('shop-${shop.id}'),
    name: shop.name,
    district: shop.ilce,
    // The directory always sends distance_m; 0 only for rows built
    // without a query point.
    distanceMeters: shop.distanceM ?? 0,
    category: categoryForShopType(shop.type),
    availableCount: shop.availableCount < 0 ? 0 : shop.availableCount,
    verified: true,
    isSample: shop.isSample,
    onTap: onTap,
  );
}
