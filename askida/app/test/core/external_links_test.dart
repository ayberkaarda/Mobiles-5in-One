import 'package:askida/core/links/external_links.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fakes/fake_external_links.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('allowlist', () {
    test('legal pages and store pages are allowed', () {
      for (final raw in [
        'https://askida.app/gizlilik',
        'https://askida.app/hesap-silme',
        'https://play.google.com/store/apps/details?id=app.askida.mobile',
        'https://apps.apple.com/tr/app/askida/id0',
      ]) {
        expect(isAllowedExternalLink(Uri.parse(raw)), isTrue, reason: raw);
      }
    });

    test('everything else is refused', () {
      for (final raw in [
        'http://askida.app/gizlilik',
        'https://evil.example/askida.app',
        'https://askida.app.evil.example/',
        'https://user@askida.app/',
        'https://askida.app:8443/',
        'intent://scan#Intent;end',
        'javascript:alert(1)',
        'askida://shop/x',
      ]) {
        expect(isAllowedExternalLink(Uri.parse(raw)), isFalse, reason: raw);
      }
    });
  });

  test('refused links never reach the platform', () async {
    final launched = <Uri>[];
    final links = UrlLauncherExternalLinks(
      launcher: (uri) async {
        launched.add(uri);
        return true;
      },
    );
    expect(await links.open(Uri.parse('http://askida.app/')), isFalse);
    expect(await links.open(Uri.parse('https://askida.app/gizlilik')), isTrue);
    expect(launched, [Uri.parse('https://askida.app/gizlilik')]);
  });

  test('a platform failure reports false instead of crashing', () async {
    final links = UrlLauncherExternalLinks(
      launcher: (uri) async =>
          throw PlatformException(code: 'ACTIVITY_NOT_FOUND'),
    );
    expect(await links.open(Uri.parse('https://askida.app/sss')), isFalse);
  });

  test('the default launcher goes through url_launcher', () async {
    // Without a registered url_launcher platform the plugin throws; the
    // wrapper turns that into "not opened".
    const links = UrlLauncherExternalLinks();
    expect(await links.open(Uri.parse('https://askida.app/sss')), isFalse);
  });

  test('fake applies the same rule', () async {
    final fake = FakeExternalLinks();
    await fake.open(Uri.parse('https://askida.app/kvkk-aydinlatma'));
    await fake.open(Uri.parse('https://evil.example/'));
    expect(fake.opened, hasLength(1));
    expect(fake.refused, hasLength(1));
  });
}
