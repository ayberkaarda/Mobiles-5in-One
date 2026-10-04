import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Reads an Android XML file and drops comments, so assertions see only
/// what Android sees.
String _xml(String path) =>
    File(path)
        .readAsStringSync()
        .replaceAll(RegExp('<!--.*?-->', dotAll: true), '');

List<RegExpMatch> _elements(String xml, String tag) => RegExp(
  '<$tag\\b([^>]*)>(.*?)</$tag>',
  dotAll: true,
).allMatches(xml).toList();

String? _attr(String attributes, String name) =>
    RegExp('$name="([^"]*)"').firstMatch(attributes)?.group(1);

const _main = 'android/app/src/main/res/xml/network_security_config.xml';
const _dev = 'android/app/src/dev/res/xml/network_security_config.xml';
const _manifest = 'android/app/src/main/AndroidManifest.xml';

void main() {
  group('prod (main) network security config', () {
    final xml = _xml(_main);

    test('denies cleartext everywhere', () {
      final base = _elements(xml, 'base-config');
      expect(base, hasLength(1));
      expect(
        _attr(base.single.group(1)!, 'cleartextTrafficPermitted'),
        'false',
      );
      expect(xml, isNot(contains('cleartextTrafficPermitted="true"')));
      expect(_elements(xml, 'domain-config'), isEmpty);
    });

    test('trusts system certificates only', () {
      expect(xml, contains('<certificates src="system" />'));
      expect(xml, isNot(contains('src="user"')));
    });
  });

  group('dev network security config', () {
    final xml = _xml(_dev);

    test('allows cleartext only to 10.0.2.2 and localhost', () {
      final base = _elements(xml, 'base-config').single;
      expect(_attr(base.group(1)!, 'cleartextTrafficPermitted'), 'false');

      final domains = _elements(xml, 'domain-config');
      expect(domains, hasLength(1));
      expect(
        _attr(domains.single.group(1)!, 'cleartextTrafficPermitted'),
        'true',
      );
      final hosts = _elements(domains.single.group(2)!, 'domain');
      expect(hosts.map((m) => m.group(2)!.trim()).toSet(), {
        '10.0.2.2',
        'localhost',
      });
      for (final host in hosts) {
        expect(_attr(host.group(1)!, 'includeSubdomains'), 'false');
      }
    });

    test('no other source set relaxes cleartext', () {
      final relaxed = Directory('android/app/src')
          .listSync(recursive: true)
          .whereType<File>()
          .where((f) => f.path.endsWith('.xml'))
          .where(
            (f) => f.readAsStringSync().contains(
              'cleartextTrafficPermitted="true"',
            ),
          )
          .map((f) => f.uri.pathSegments.skipWhile((s) => s != 'src').join('/'))
          .toList();
      expect(relaxed, ['src/dev/res/xml/network_security_config.xml']);
    });
  });

  group('manifest', () {
    final xml = _xml(_manifest);

    test('uses the config and keeps cleartext off by default', () {
      expect(
        xml,
        contains(
          'android:networkSecurityConfig="@xml/network_security_config"',
        ),
      );
      expect(xml, contains('android:usesCleartextTraffic="false"'));
      expect(xml, contains('android.permission.INTERNET'));
    });

    test('declares the shop web link (autoVerify) and the custom scheme', () {
      final filters = _elements(xml, 'intent-filter');
      final web = filters.where(
        (f) =>
            f.group(2)!.contains('android:scheme="https"') &&
            f.group(2)!.contains('android:host="askida.app"') &&
            f.group(2)!.contains('android:pathPrefix="/dukkan/"'),
      );
      expect(web, hasLength(1));
      expect(_attr(web.single.group(1)!, 'android:autoVerify'), 'true');

      final custom = filters.where(
        (f) => f.group(2)!.contains('android:scheme="askida"'),
      );
      expect(custom, hasLength(1));
      expect(custom.single.group(2), contains('android:host="shop"'));
      expect(custom.single.group(2), contains('android:host="donation"'));
      expect(xml, contains('flutter_deeplinking_enabled'));
    });
  });
}
