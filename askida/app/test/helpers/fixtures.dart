import 'dart:convert';
import 'dart:io';

/// JSON bodies shaped like the server's real answers live in
/// `test/fixtures/<name>.json`. Feature tests reuse them through these
/// helpers so every layer agrees on one shape.
Map<String, dynamic> fixture(String name) =>
    jsonDecode(File('test/fixtures/$name.json').readAsStringSync())
        as Map<String, dynamic>;

/// The `data` member of a wrapped fixture.
Map<String, dynamic> fixtureData(String name) =>
    fixture(name)['data'] as Map<String, dynamic>;

/// The `data` list of a wrapped list fixture.
List<Map<String, dynamic>> fixtureList(String name) => [
  for (final row in fixture(name)['data'] as List<dynamic>)
    row as Map<String, dynamic>,
];

int _counter = 0;

/// A bearer value built at run time; no credential-shaped literal is ever
/// written into the repository.
String dummyToken([String label = 'user']) {
  _counter++;
  return [
    label,
    'test',
    '$_counter',
    '${DateTime.now().microsecond}',
  ].join('-');
}

/// Token body fixtures carry no token; it is added here at run time.
Map<String, dynamic> authSessionJson({
  String fixtureName = 'auth_session',
  String? token,
}) => {...fixture(fixtureName), 'token': token ?? dummyToken()};

Map<String, dynamic> anonSessionJson({String? token}) => {
  ...fixture('anon_session'),
  'token': token ?? dummyToken('anon'),
};

/// Names of every fixture file, for documentation and sanity tests.
const fixtureNames = <String>[
  'anon_session',
  'auth_session',
  'auth_session_merchant',
  'deletion_pending',
  'document_confirmed',
  'document_presign',
  'donation',
  'donation_checkout',
  'donations',
  'impact',
  'item_owner',
  'items_owner',
  'payouts',
  'problem_anon_daily_cap',
  'problem_rate_limited',
  'problem_unauthenticated',
  'problem_validation',
  'redeem_result',
  'redemptions',
  'reservation',
  'shop_owner',
  'shop_public',
  'shops_nearby',
  'user',
];
