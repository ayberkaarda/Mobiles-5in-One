import 'package:askida/data/session.dart';
import 'package:askida/routing/guards.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fakes/fake_auth_repository.dart';

void main() {
  const nobody = SessionState(restored: true);
  final donor = SessionState(
    user: FakeAuthRepository.sampleDonor(),
    hasUserToken: true,
    restored: true,
  );
  final merchant = SessionState(
    user: FakeAuthRepository.sampleMerchant(),
    hasUserToken: true,
    restored: true,
  );
  const anon = SessionState(hasAnonToken: true, restored: true);

  String? go(String location, SessionState session) =>
      guardRedirect(Uri.parse(location), session);

  test('mode homes and public screens are open to everyone', () {
    for (final location in [
      '/recipient',
      '/donor',
      '/merchant',
      '/donor/shop/ornek',
      '/recipient/shop/ornek',
      '/auth',
      '/settings',
    ]) {
      expect(go(location, nobody), isNull, reason: location);
    }
  });

  test('merchant screens need a signed-in merchant', () {
    expect(
      go('/merchant/redemptions', nobody),
      '/auth?from=%2Fmerchant%2Fredemptions',
    );
    expect(go('/merchant/redemptions', donor), '/merchant');
    expect(go('/merchant/redemptions', merchant), isNull);
  });

  test('donor-only screens need a signed-in donor', () {
    expect(
      go('/donor/donate?shop=a', nobody),
      '/auth?from=%2Fdonor%2Fdonate%3Fshop%3Da',
    );
    expect(go('/donor/donations', merchant), '/donor');
    expect(go('/donor/donation/abc?status=paid', donor), isNull);
  });

  test('anon screens need the anon token', () {
    expect(
      go('/recipient/code', nobody),
      '/recipient/start?from=%2Frecipient%2Fcode',
    );
    expect(go('/recipient/reserve/x', donor), startsWith('/recipient/start'));
    expect(go('/recipient/code', anon), isNull);
  });

  test('a stored token whose user is not loaded is not signed in', () {
    const offline = SessionState(hasUserToken: true, restored: true);
    expect(go('/merchant/scan', offline), startsWith('/auth?from='));
  });

  test('nothing is redirected before the session is restored', () {
    expect(go('/merchant/redemptions', const SessionState()), isNull);
    expect(go('/recipient/code', const SessionState()), isNull);
  });

  test('requirements by prefix', () {
    expect(requirementOf('/merchant'), RouteRequirement.none);
    expect(requirementOf('/merchant/x'), RouteRequirement.merchant);
    expect(requirementOf('/donor/donations'), RouteRequirement.donor);
    expect(requirementOf('/recipient/code'), RouteRequirement.anon);
  });
}
