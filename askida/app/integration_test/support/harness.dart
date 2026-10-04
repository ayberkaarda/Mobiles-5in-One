import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:askida/app.dart';
import 'package:askida/core/env/app_env.dart';
import 'package:askida/core/platform/media_picker.dart';
import 'package:askida/core/qr/qr_scanner.dart';
import 'package:askida/core/storage/secure_token_store.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:askida/routing/app_router.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

/// Settings of the end-to-end run. The defaults reach the `askida-e2e`
/// compose stack from the Android emulator (host = 10.0.2.2); the run script
/// passes the same values as defines.
abstract final class E2eConfig {
  static const apiBaseUrl = String.fromEnvironment(
    'E2E_API_BASE_URL',
    defaultValue: 'http://10.0.2.2:58471/api/v1',
  );

  /// Mailpit HTTP API of the stack (verification codes are read there).
  static const mailApi = String.fromEnvironment(
    'E2E_MAIL_API',
    defaultValue: 'http://10.0.2.2:58472/api/v1',
  );
}

/// Turkish copy, the app default.
final AppLocalizations tr = lookupAppLocalizations(const Locale('tr'));

/// Prints one line the run script can find in the test output.
void mark(String step) => debugPrint('E2E-STEP $step');

/// Starts the real app (real HTTP client, database, links, attestation
/// channel, WebView) against the stack. Only the token store is kept in
/// memory, so one test process can act as several people; [picker] and the
/// scanner are the two device seams a headless emulator cannot drive.
Future<void> launchApp(
  WidgetTester tester, {
  required TokenStore tokens,
  MediaPicker? picker,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      key: UniqueKey(),
      overrides: [
        appEnvProvider.overrideWithValue(AppEnv.parse(E2eConfig.apiBaseUrl)),
        tokenStoreProvider.overrideWithValue(tokens),
        qrScannerFactoryProvider.overrideWithValue(ManualOnlyScanner.new),
        if (picker != null) mediaPickerProvider.overrideWithValue(picker),
      ],
      child: const AskidaApp(),
    ),
  );
  await settleSoon(tester);
}

ProviderContainer containerOf(WidgetTester tester) =>
    ProviderScope.containerOf(tester.element(find.byType(AskidaApp)));

GoRouter routerOf(WidgetTester tester) =>
    containerOf(tester).read(appRouterProvider);

Future<void> go(WidgetTester tester, String location) async {
  routerOf(tester).go(location);
  await settleSoon(tester);
}

/// Pumps frames for a while without waiting for every animation to stop
/// (countdowns and progress indicators never settle).
Future<void> settleSoon(
  WidgetTester tester, [
  Duration duration = const Duration(milliseconds: 600),
]) async {
  final end = DateTime.now().add(duration);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

/// Pumps until [finder] matches, or fails after [timeout].
Future<void> pumpUntil(
  WidgetTester tester,
  Finder finder, {
  Duration timeout = const Duration(seconds: 30),
  String? reason,
}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 100));
    if (finder.evaluate().isNotEmpty) return;
  }
  fail(
    'Timed out waiting for '
    '${reason ?? finder.describeMatch(Plurality.one)}\n${screenSummary()}',
  );
}

/// Waits for [finder]; when it does not show up because it sits below the
/// built part of a list, scrolls the screen's list towards it.
Future<void> reveal(WidgetTester tester, Finder finder) async {
  final end = DateTime.now().add(const Duration(seconds: 3));
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 100));
    if (finder.evaluate().isNotEmpty) return;
  }
  final lists = find.byWidgetPredicate(
    (w) => w is Scrollable && w.axisDirection == AxisDirection.down,
  );
  if (lists.evaluate().isNotEmpty) {
    try {
      await tester.scrollUntilVisible(finder, 300, scrollable: lists.first);
    } on Object {
      // Not in this list; the wait below reports it.
    }
  }
  await pumpUntil(tester, finder);
}

/// Where the app is and what it shows, for failure messages.
String screenSummary() {
  final keys = <String>{
    for (final e
        in find.byWidgetPredicate((w) => w.key is ValueKey<String>).evaluate())
      (e.widget.key! as ValueKey<String>).value,
  };
  final texts = <String>[
    for (final e in find.byType(Text).evaluate())
      if ((e.widget as Text).data case final String data) data,
  ];
  String? location;
  final apps = find.byType(AskidaApp).evaluate();
  if (apps.isNotEmpty) {
    location = ProviderScope.containerOf(apps.first)
        .read(appRouterProvider)
        .state
        .uri
        .toString();
  }
  return 'location: $location\nkeys: ${keys.take(40).join(', ')}\n'
      'texts: ${texts.take(30).join(' | ')}';
}

Future<void> tapOn(WidgetTester tester, Finder finder) async {
  await reveal(tester, finder);
  await tester.ensureVisible(finder.first);
  await tester.pump(const Duration(milliseconds: 200));
  await tester.tap(finder.first, warnIfMissed: false);
  await settleSoon(tester, const Duration(milliseconds: 400));
}

Future<void> enterInto(WidgetTester tester, Finder finder, String text) async {
  await reveal(tester, finder);
  await tester.ensureVisible(finder.first);
  await tester.pump(const Duration(milliseconds: 200));
  await tester.enterText(finder.first, text);
  await tester.pump(const Duration(milliseconds: 200));
}

Finder byKey(String key) => find.byKey(ValueKey(key));

/// Unique suffix for the e-mails and names of one run.
final String runId = DateTime.now().millisecondsSinceEpoch.toRadixString(36);

final Random _random = Random.secure();

/// A throwaway password built at run time (never written down).
String throwawayPassword() => List.generate(
  20,
  (_) => 'abcdefghjkmnpqrstuvwxyz23456789'[_random.nextInt(31)],
).join();

/// A tax number with a valid check digit (same rule as the server).
String randomTaxNumber() {
  final first = List.generate(9, (_) => _random.nextInt(10)).join();
  var sum = 0;
  for (var i = 0; i < 9; i++) {
    final shifted = (int.parse(first[i]) + 9 - i) % 10;
    var weighted = (shifted * pow(2, 9 - i).toInt()) % 9;
    if (shifted != 0 && weighted == 0) weighted = 9;
    sum += weighted;
  }
  return '$first${(10 - sum % 10) % 10}';
}

/// A Turkish IBAN with a valid mod-97 checksum, made up at run time.
String randomIban() {
  final bban =
      '00061${'0'}${List.generate(16, (_) => _random.nextInt(10)).join()}';
  // T = 29, R = 27; check digits 00 while computing.
  final remainder = BigInt.parse('${bban}292700') % BigInt.from(97);
  final check = (98 - remainder.toInt()).toString().padLeft(2, '0');
  return 'TR$check$bban';
}

/// Reads the newest verification code sent to [email] from the stack's
/// mail catcher.
Future<String> verificationCodeFor(String email) async {
  final client = HttpClient();
  try {
    final end = DateTime.now().add(const Duration(seconds: 90));
    while (DateTime.now().isBefore(end)) {
      final search = await _getJson(
        client,
        '${E2eConfig.mailApi}/search?query=${Uri.encodeQueryComponent('to:"$email"')}',
      );
      final messages = (search['messages'] as List?) ?? const [];
      if (messages.isNotEmpty) {
        final id = (messages.first as Map)['ID'] as String;
        final message = await _getJson(
          client,
          '${E2eConfig.mailApi}/message/$id',
        );
        final match = RegExp(r'\b(\d{6})\b')
            .firstMatch(message['Text'] as String);
        if (match != null) return match.group(1)!;
      }
      await Future<void>.delayed(const Duration(seconds: 2));
    }
    throw StateError('No verification mail for $email');
  } finally {
    client.close(force: true);
  }
}

/// Status code of `GET <api>/<path>` sent with [token], outside the app.
Future<int> statusWithToken(String path, String token) async {
  final client = HttpClient();
  try {
    final request = await client.getUrl(
      Uri.parse('${E2eConfig.apiBaseUrl}/$path'),
    );
    request.headers
      ..set(HttpHeaders.acceptHeader, 'application/json')
      ..set(HttpHeaders.authorizationHeader, 'Bearer $token');
    final response = await request.close();
    await response.drain<void>();
    return response.statusCode;
  } finally {
    client.close(force: true);
  }
}

Future<Map<String, dynamic>> _getJson(HttpClient client, String url) async {
  final request = await client.getUrl(Uri.parse(url));
  final response = await request.close();
  final body = await response.transform(utf8.decoder).join();
  return jsonDecode(body) as Map<String, dynamic>;
}

/// Picker that hands over a small PNG made in memory (the emulator has no
/// document to photograph); presign, upload and confirm are the real ones.
class InMemoryPngPicker implements MediaPicker {
  int picks = 0;

  @override
  Future<PickedDocument?> pickDocument({required DocumentSource source}) async {
    picks++;
    return PickedDocument(
      bytes: solidPng(32, 32),
      mime: 'image/png',
      name: 'belge.png',
    );
  }
}

/// The redemption screen's scanner on a device without a usable camera: no
/// preview, no codes; the merchant types the code by hand.
class ManualOnlyScanner implements QrScanner {
  final StreamController<String> _codes = StreamController.broadcast();
  final ValueNotifier<bool> _torch = ValueNotifier(false);

  @override
  Stream<String> get codes => _codes.stream;

  @override
  ValueListenable<bool> get torchOn => _torch;

  @override
  Future<void> start() async {}

  @override
  Future<void> stop() async {}

  @override
  Future<void> toggleTorch() async {}

  @override
  Widget preview() => const ColoredBox(color: Colors.black12);

  @override
  Future<void> dispose() async {
    await _codes.close();
    _torch.dispose();
  }
}

/// An uncompressed-filter, zlib-deflated RGB PNG of one colour.
Uint8List solidPng(int width, int height) {
  final raw = BytesBuilder();
  for (var y = 0; y < height; y++) {
    raw.addByte(0);
    for (var x = 0; x < width; x++) {
      raw.add(const [0xF2, 0xB1, 0x34]);
    }
  }
  final ihdr = ByteData(13)
    ..setUint32(0, width)
    ..setUint32(4, height)
    ..setUint8(8, 8)
    ..setUint8(9, 2)
    ..setUint8(10, 0)
    ..setUint8(11, 0)
    ..setUint8(12, 0);
  final out = BytesBuilder()
    ..add(const [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    ..add(_chunk('IHDR', ihdr.buffer.asUint8List()))
    ..add(_chunk('IDAT', Uint8List.fromList(ZLibCodec().encode(raw.toBytes()))))
    ..add(_chunk('IEND', Uint8List(0)));
  return out.toBytes();
}

Uint8List _chunk(String type, Uint8List data) {
  final typeBytes = ascii.encode(type);
  final length = ByteData(4)..setUint32(0, data.length);
  final crc = ByteData(4)..setUint32(0, _crc32([...typeBytes, ...data]));
  return Uint8List.fromList([
    ...length.buffer.asUint8List(),
    ...typeBytes,
    ...data,
    ...crc.buffer.asUint8List(),
  ]);
}

int _crc32(List<int> bytes) {
  var crc = 0xFFFFFFFF;
  for (final byte in bytes) {
    crc ^= byte;
    for (var k = 0; k < 8; k++) {
      crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xEDB88320 : crc >> 1;
    }
  }
  return crc ^ 0xFFFFFFFF;
}
