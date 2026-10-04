import 'package:askida/features/merchant/domain/merchant_shop.dart';
import 'package:askida/features/merchant/domain/redemption_code.dart';
import 'package:askida/features/merchant/domain/redemption_days.dart';
import 'package:askida/features/merchant/domain/shop_rules.dart';
import 'package:askida/features/merchant/presentation/providers/merchant_shop_controller.dart';
import 'package:flutter_test/flutter_test.dart';

import 'merchant_harness.dart';

void main() {
  group('RedemptionCode', () {
    test('normalises typed and scanned input', () {
      expect(RedemptionCode.normalise('K7M2QX9R'), 'K7M2QX9R');
      expect(RedemptionCode.normalise(' k7m2 qx9r '), 'K7M2QX9R');
      expect(RedemptionCode.normalise('k7m2-qx9r'), 'K7M2QX9R');
      // Look-alikes fold like the server does.
      expect(RedemptionCode.normalise('ABCO ILXY'), 'ABC011XY');
    });

    test('refuses anything that cannot be a code', () {
      expect(RedemptionCode.normalise(''), isNull);
      expect(RedemptionCode.normalise('K7M2QX9'), isNull);
      expect(RedemptionCode.normalise('K7M2QX9RR'), isNull);
      expect(RedemptionCode.normalise('https://askida.app'), isNull);
      expect(RedemptionCode.normalise('K7M2QX9Ş'), isNull);
    });

    test('ascii casing leaves Turkish letters alone', () {
      expect(RedemptionCode.asciiUpper('abcçğıiz'), 'ABCçğıIZ');
    });

    test('groups in fours', () {
      expect(RedemptionCode.grouped('K7M2QX9R'), 'K7M2 QX9R');
      expect(RedemptionCode.grouped('K7M2'), 'K7M2');
    });
  });

  group('ShopRules', () {
    test('phone shapes the server accepts', () {
      expect(ShopRules.normalisePhone('0212 555 00 00'), '+902125550000');
      expect(ShopRules.normalisePhone('+90 (532) 555-00-00'), '+905325550000');
      expect(ShopRules.normalisePhone('5325550000'), '+905325550000');
      expect(ShopRules.normalisePhone('1234'), isNull);
      expect(ShopRules.phone(''), FieldIssue.required);
      expect(ShopRules.phone('12'), FieldIssue.invalid);
    });

    test('tax number is ten digits', () {
      expect(ShopRules.taxNumber('123 456 7890'), isNull);
      expect(ShopRules.taxNumber('12345'), FieldIssue.invalid);
      expect(ShopRules.taxNumber(''), FieldIssue.required);
      expect(ShopRules.normaliseTaxNumber('123 456 7890'), '1234567890');
    });

    test('IBAN: TR, 24 digits and a valid checksum', () {
      final valid = sampleIban();
      expect(ShopRules.iban(valid), isNull);
      final spaced = [
        for (var i = 0; i < valid.length; i += 4)
          valid.substring(i, i + 4 > valid.length ? valid.length : i + 4),
      ].join(' ');
      expect(ShopRules.iban(spaced.replaceFirst('TR', 'tr')), isNull);
      final broken = valid.replaceRange(25, 26, valid[25] == '1' ? '2' : '1');
      expect(ShopRules.iban(broken), FieldIssue.invalid);
      expect(ShopRules.iban('DE89'), FieldIssue.invalid);
      expect(ShopRules.iban(''), FieldIssue.required);
    });

    test('text length rules', () {
      expect(ShopRules.text('', min: 2, max: 5), FieldIssue.required);
      expect(ShopRules.text('a', min: 2, max: 5), FieldIssue.tooShort);
      expect(ShopRules.text('abcdef', min: 2, max: 5), FieldIssue.tooLong);
      expect(ShopRules.text(' ab ', min: 2, max: 5), isNull);
    });
  });

  group('ItemRules', () {
    test('prices parse to kuruş with integers only', () {
      expect(ItemRules.parsePriceMinor('15'), 1500);
      expect(ItemRules.parsePriceMinor('15,5'), 1550);
      expect(ItemRules.parsePriceMinor('15,50'), 1550);
      expect(ItemRules.parsePriceMinor('1.234,50'), 123450);
      expect(ItemRules.parsePriceMinor('15.50'), 1550);
      expect(ItemRules.parsePriceMinor('₺ 45,00'), 4500);
      expect(ItemRules.parsePriceMinor('0,01'), 1);
      expect(ItemRules.parsePriceMinor('15,505'), isNull);
      expect(ItemRules.parsePriceMinor('abc'), isNull);
      expect(ItemRules.parsePriceMinor(''), isNull);
    });

    test('price, cap and name limits', () {
      expect(ItemRules.price('0,99'), FieldIssue.outOfRange);
      expect(ItemRules.price('10.000,01'), FieldIssue.outOfRange);
      expect(ItemRules.price('10.000,00'), isNull);
      expect(ItemRules.price('x'), FieldIssue.invalid);
      expect(ItemRules.dailyCap('0'), FieldIssue.outOfRange);
      expect(ItemRules.dailyCap('1001'), FieldIssue.outOfRange);
      expect(ItemRules.dailyCap('50'), isNull);
      expect(ItemRules.dailyCap('5,5'), FieldIssue.invalid);
      expect(ItemRules.name(''), FieldIssue.required);
      expect(ItemRules.name('a' * 121), FieldIssue.tooLong);
    });

    test('price input round trip', () {
      expect(ItemRules.priceInput(1550), '15,50');
      expect(ItemRules.priceInput(100), '1,00');
      expect(ItemRules.parsePriceMinor(ItemRules.priceInput(98765)), 98765);
    });
  });

  group('ShopLink', () {
    const link = ShopLink(
      shopId: 'shop-1',
      slug: 'kose-firini',
      name: '[ÖRNEK] Köşe Fırını',
      role: MerchantRole.staff,
    );

    test('encodes and decodes', () {
      expect(ShopLink.decode(link.encode()), link);
    });

    test('unreadable values decode to null', () {
      expect(ShopLink.decode(null), isNull);
      expect(ShopLink.decode(''), isNull);
      expect(ShopLink.decode('a\nb\nc\nboss'), isNull);
      expect(ShopLink.decode('\nb\nc\nowner'), isNull);
    });
  });

  test('slugFromInput accepts a slug or the shop address', () {
    expect(slugFromInput('kose-firini'), 'kose-firini');
    expect(slugFromInput('askida.app/dukkan/kose-firini'), 'kose-firini');
    expect(
      slugFromInput('https://askida.app/dukkan/kose-firini/?ref=x'),
      'kose-firini',
    );
    expect(slugFromInput('Köşe Fırını'), isNull);
    expect(slugFromInput(''), isNull);
  });

  test('the log covers today and the 29 days before', () {
    final days = recentLogDays(DateTime(2026, 10, 4, 9, 41));
    expect(days, hasLength(kLogDays));
    expect(days.first, const LogDay(2026, 10, 4));
    expect(days[3], const LogDay(2026, 10, 1));
    expect(days[4], const LogDay(2026, 9, 30));
    expect(days.last, const LogDay(2026, 9, 5));
    expect(days.first.key, '2026-10-04');
    expect(days.first.end, DateTime(2026, 10, 5));
  });
}
