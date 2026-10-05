import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/reservation.dart';
import 'package:askida/data/repositories/hooks_repository.dart';

import '../helpers/fixtures.dart';
import 'scriptable.dart';

/// In-memory [HooksRepository]. [validCodes] are redeemable once; anything
/// else answers `hook.code_invalid`, like the server.
class FakeHooksRepository with Scriptable implements HooksRepository {
  new({Reservation? reservation})
    : reservation =
          reservation ?? Reservation.fromJson(fixture('reservation')) {
    validCodes.add(this.reservation.code);
  }

  /// What [reserve] answers.
  Reservation reservation;

  final Set<String> validCodes = {};

  /// Redemptions answered by [redemptions], newest first.
  final List<Redemption> log = fixtureList('redemptions')
      .map(Redemption.fromJson)
      .toList();

  @override
  Future<Reservation> reserve(String shopId, String itemId) async {
    record('reserve');
    return reservation;
  }

  @override
  Future<RedeemResult> redeem(String shopId, String code) async {
    record('redeem');
    final normalised = code
        .toUpperCase()
        .replaceAll(RegExp('[ -]'), '')
        .replaceAll(RegExp('[IL]'), '1')
        .replaceAll('O', '0');
    if (!validCodes.remove(normalised)) {
      throw const ApiProblem(code: 'hook.code_invalid', status: 422);
    }
    final result = RedeemResult.fromJson(fixture('redeem_result'));
    log.insert(0, Redemption(item: result.item, redeemedAt: result.redeemedAt));
    return result;
  }

  @override
  Future<RedemptionDay> redemptions(String shopId, {DateTime? day}) async {
    record('redemptions');
    return RedemptionDay(
      day:
          (fixture('redemptions')['meta'] as Map<String, dynamic>)['day']
              as String,
      count: log.length,
      redemptions: List.unmodifiable(log),
    );
  }
}
