import 'package:askida/routing/app_mode.dart';
import 'package:askida/routing/deep_links.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('parseDeepLink', () {
    test('custom scheme shop link', () {
      expect(
        parseDeepLink(Uri.parse('askida://shop/ornek-kose-firini-sisli')),
        const ShopLink('ornek-kose-firini-sisli'),
      );
    });

    test('web shop link', () {
      expect(
        parseDeepLink(Uri.parse('https://askida.app/dukkan/ornek-firin')),
        const ShopLink('ornek-firin'),
      );
      expect(
        parseDeepLink(Uri.parse('https://askida.app/dukkan/ornek-firin/')),
        const ShopLink('ornek-firin'),
      );
    });

    test('donation return link with and without status', () {
      expect(
        parseDeepLink(
          Uri.parse(
            'askida://donation/0192a4c1-a000-7a10-9b3c-000000000031'
            '?status=paid',
          ),
        ),
        const DonationReturnLink(
          '0192a4c1-a000-7a10-9b3c-000000000031',
          'paid',
        ),
      );
      expect(
        parseDeepLink(Uri.parse('askida://donation/abc-1')),
        const DonationReturnLink('abc-1', null),
      );
    });

    test('a malformed status is dropped, the link still opens', () {
      expect(
        parseDeepLink(Uri.parse('askida://donation/abc-1?status=<b>x</b>')),
        const DonationReturnLink('abc-1', null),
      );
    });

    test('unknown or foreign links are null', () {
      for (final raw in [
        'askida://elsewhere/x',
        'askida://shop',
        'askida://shop/a/b',
        'askida://shop/Bad Slug',
        'http://askida.app/dukkan/ornek',
        'https://evil.example/dukkan/ornek',
        'https://askida.app/pay/token',
        'https://askida.app/dukkan',
        'mailto:x@example.com',
      ]) {
        expect(parseDeepLink(Uri.parse(raw)), isNull, reason: raw);
      }
    });
  });

  group('locationForLink', () {
    test('shop links open in the current mode; merchant uses donor', () {
      const link = ShopLink('ornek-firin');
      expect(
        locationForLink(link, AppMode.recipient),
        '/recipient/shop/ornek-firin',
      );
      expect(locationForLink(link, AppMode.donor), '/donor/shop/ornek-firin');
      expect(
        locationForLink(link, AppMode.merchant),
        '/donor/shop/ornek-firin',
      );
    });

    test('donation return goes to the receipt', () {
      expect(
        locationForLink(
          const DonationReturnLink('abc-1', 'failed'),
          AppMode.recipient,
        ),
        '/donor/donation/abc-1?status=failed',
      );
    });

    test('unknown links go to the current mode home', () {
      expect(locationForLink(null, AppMode.merchant), '/merchant');
      expect(locationForLink(null, AppMode.recipient), '/recipient');
    });
  });
}
