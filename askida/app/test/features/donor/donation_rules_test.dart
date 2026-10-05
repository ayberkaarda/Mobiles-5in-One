import 'package:askida/features/donor/domain/donation_rules.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('one payment allows at most 20 units and ₺2 000', () {
    expect(DonationRules.maxQtyFor(1500), 20);
    expect(DonationRules.maxQtyFor(10000), 20);
    expect(DonationRules.maxQtyFor(10001), 19);
    expect(DonationRules.maxQtyFor(15000), 13);
    expect(DonationRules.maxQtyFor(200000), 1);
    expect(DonationRules.maxQtyFor(200001), 0);
  });

  test('the total is integer kuruş', () {
    expect(DonationRules.totalMinor(1500, 3), 4500);
    expect(DonationRules.totalMinor(4550, 20), 91000);
  });

  test('the hint names the limit that stops a higher quantity', () {
    expect(qtyLimitFor(1500, 19), QtyLimit.none);
    expect(qtyLimitFor(1500, 20), QtyLimit.maxUnits);
    expect(qtyLimitFor(15000, 12), QtyLimit.none);
    expect(qtyLimitFor(15000, 13), QtyLimit.transactionCap);
  });
}
