import 'package:askida/data/models/money.dart';
import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('formats kuruş in Turkish', () {
    expect(const Money(4500).format(), '₺45,00');
    expect(const Money(5).format(), '₺0,05');
    expect(const Money(123450).format(), '₺1.234,50');
    expect(const Money(200000).format(), '₺2.000,00');
    expect(const Money(-1500).format(), '-₺15,00');
  });

  test('formats kuruş in English', () {
    expect(const Money(4500).format('en'), '₺45.00');
    expect(const Money(123450).format('en'), '₺1,234.50');
  });

  test('large values never lose a kuruş', () {
    expect(const Money(9007199254740).format(), '₺90.071.992.547,40');
  });

  test('carries the tabular figure hint', () {
    expect(Money.tabularFigures, contains(const FontFeature.tabularFigures()));
  });
}
