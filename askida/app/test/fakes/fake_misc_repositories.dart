import 'package:askida/data/models/impact_summary.dart';
import 'package:askida/data/models/payout.dart';
import 'package:askida/data/repositories/impact_repository.dart';
import 'package:askida/data/repositories/payouts_repository.dart';
import 'package:askida/data/repositories/push_repository.dart';

import '../helpers/fixtures.dart';
import 'scriptable.dart';

class FakePayoutsRepository with Scriptable implements PayoutsRepository {
  new({List<Payout>? rows})
    : rows = rows ?? fixtureList('payouts').map(Payout.fromJson).toList();

  final List<Payout> rows;

  @override
  Future<List<Payout>> payouts(String shopId) async {
    record('payouts');
    return List.unmodifiable(rows);
  }
}

class FakeImpactRepository with Scriptable implements ImpactRepository {
  new({ImpactSummary? summary})
    : summary = summary ?? ImpactSummary.fromJson(fixtureData('impact'));

  ImpactSummary summary;

  /// Arguments of the last call.
  ({String? il, String? ilce})? lastQuery;

  @override
  Future<ImpactSummary> impact({String? il, String? ilce}) async {
    record('impact');
    lastQuery = (il: il, ilce: ilce);
    return summary;
  }
}

class FakePushRepository with Scriptable implements PushRepository {
  /// `(platform, token)` pairs registered, in order.
  final List<(String, String)> registered = [];

  @override
  Future<void> registerToken(String platform, String token) async {
    record('registerToken');
    registered.add((platform, token));
  }
}
