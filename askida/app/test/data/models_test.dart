import 'dart:io';

import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/auth_session.dart';
import 'package:askida/data/models/donation.dart';
import 'package:askida/data/models/impact_summary.dart';
import 'package:askida/data/models/item.dart';
import 'package:askida/data/models/payout.dart';
import 'package:askida/data/models/reservation.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/data/models/shop_document.dart';
import 'package:askida/data/models/user.dart';
import 'package:flutter_test/flutter_test.dart';

import '../helpers/fixtures.dart';

void main() {
  test('every fixture file is listed and every listed one exists', () {
    final onDisk = Directory('test/fixtures')
        .listSync()
        .whereType<File>()
        .map((f) => f.uri.pathSegments.last.replaceAll('.json', ''))
        .toSet();
    expect(onDisk, fixtureNames.toSet());
  });

  test('user and token bodies', () {
    final user = User.fromJson(fixtureData('user'));
    expect(user.kind, UserKind.donor);
    expect(user.emailVerified, isTrue);

    final token = dummyToken();
    final session = AuthSession.fromJson(authSessionJson(token: token));
    expect(session.token, token);
    expect(session.tokenType, 'Bearer');
    expect(session.abilities, ['donor']);
    expect(session.user.emailVerified, isFalse);
    expect(session.toJson()['token_type'], 'Bearer');

    final anon = AnonSession.fromJson(anonSessionJson());
    expect(anon.abilities, ['anon']);

    final pending = DeletionPending.fromJson(fixture('deletion_pending'));
    expect(pending.graceUntil.toUtc(), DateTime.utc(2026, 10, 11, 6, 41));
  });

  test('shop list page, public detail and owner detail', () {
    final rows = fixtureList('shops_nearby').map(ShopSummary.fromJson).toList();
    expect(rows.first.distanceM, 450);
    expect(rows.first.type, ShopType.bakery);
    expect(rows.first.location.lat, closeTo(41.0602, 1e-9));
    expect(rows.last.availableCount, 0);

    final public = ShopDetails.fromJson(fixtureData('shop_public'));
    expect(public, isA<PublicShopDetails>());
    final shop = (public as PublicShopDetails).shop;
    expect(shop.items, hasLength(2));
    expect(shop.items.last.category, ItemCategory.corba);
    expect(shop.items.first.priceMinor, 1500);

    final owner = ShopDetails.fromJson(fixtureData('shop_owner'));
    expect(owner, isA<OwnerShopDetails>());
    final ownerShop = (owner as OwnerShopDetails).shop;
    expect(ownerShop.verificationState, VerificationState.pending);
    expect(ownerShop.verifiedAt, isNull);
    expect(ownerShop.ibanMasked, endsWith('12 34'));
  });

  test('unknown enum values fall back instead of failing', () {
    final json = {...fixtureList('shops_nearby').first, 'type': 'kiosk'};
    expect(ShopSummary.fromJson(json).type, ShopType.other);
    final item = {...fixtureData('item_owner'), 'category': 'oyuncak'};
    expect(Item.fromJson(item).category, ItemCategory.diger);
  });

  test('drafts send snake_case keys and omit unset fields', () {
    const draft = ShopDraft(name: 'Fırın', taxNumber: '1', listedOnWeb: true);
    expect(draft.toJson(), {
      'name': 'Fırın',
      'tax_number': '1',
      'listed_on_web': true,
    });
    const item = ItemDraft(priceMinor: 1500, category: ItemCategory.corba);
    expect(item.toJson(), {'category': 'corba', 'price_minor': 1500});
  });

  test('catalog, documents, hooks', () {
    final items = fixtureList('items_owner').map(Item.fromJson).toList();
    expect(items.last.active, isFalse);
    expect(items.first.dailyCap, 50);

    final presign = PresignedDocument.fromJson(fixtureData('document_presign'));
    expect(presign.document.kind, DocumentKind.vergiLevhasi);
    expect(presign.document.state, DocumentState.pending);
    expect(presign.upload.headers['Content-Type'], 'application/pdf');
    expect(
      ShopDocument.fromJson(fixtureData('document_confirmed')).state,
      DocumentState.uploaded,
    );

    final reservation = Reservation.fromJson(fixture('reservation'));
    expect(reservation.code, 'K7M2QX9R');
    expect(reservation.item.category, ItemCategory.ekmek);
    expect(reservation.shop.name, '[ÖRNEK] Köşe Fırını');

    final redeemed = RedeemResult.fromJson(fixture('redeem_result'));
    expect(redeemed.message, '1 ekmek verildi');
    final rows = fixtureList('redemptions').map(Redemption.fromJson).toList();
    expect(rows.last.redeemedByRole, 'staff');
  });

  test('donations, payouts, impact', () {
    final checkout = DonationCheckout.fromJson(fixture('donation_checkout'));
    expect(checkout.checkoutUrl, startsWith('https://askida.app/pay/'));
    final donation = Donation.fromJson(fixtureData('donation'));
    expect(donation.status, DonationStatus.paid);
    expect(donation.amountMinor, 4500);

    final payouts = fixtureList('payouts').map(Payout.fromJson).toList();
    expect(payouts.first.netMinor, 42750);
    expect(payouts.last.status, PayoutStatus.pending);

    final impact = ImpactSummary.fromJson(fixtureData('impact'));
    expect(impact.level, ImpactLevel.il);
    expect(impact.ilce, isNull);
    expect(impact.methodology, 'impact.v1.daily_units');
  });

  test('problem details with field errors', () {
    final problem = ApiProblem.fromJson(fixture('problem_validation'));
    expect(problem.code, 'validation.failed');
    expect(problem.status, 422);
    expect(problem.requestId, isNotEmpty);
    expect(problem.isValidation, isTrue);
    expect(problem.codesFor('password'), ['min']);
    expect(problem.fieldErrors, hasLength(2));

    final bare = ApiProblem.fromJson(fixture('problem_unauthenticated'));
    expect(bare.fieldErrors, isEmpty);
    expect(bare, isA<Exception>());
  });
}
