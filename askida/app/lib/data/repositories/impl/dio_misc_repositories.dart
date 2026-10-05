import 'package:askida/core/http/api_client.dart';
import 'package:askida/data/models/impact_summary.dart';
import 'package:askida/data/models/payout.dart';
import 'package:askida/data/repositories/impact_repository.dart';
import 'package:askida/data/repositories/impl/json_body.dart';
import 'package:askida/data/repositories/payouts_repository.dart';
import 'package:askida/data/repositories/push_repository.dart';

class DioPayoutsRepository implements PayoutsRepository {
  new(this._api);

  final ApiClient _api;

  @override
  Future<List<Payout>> payouts(String shopId) async {
    final answer = await _api.get('shops/$shopId/payouts');
    return parse<List<Payout>>(
      () => listOf(answer).map(Payout.fromJson).toList(),
    );
  }
}

class DioImpactRepository implements ImpactRepository {
  new(this._api);

  final ApiClient _api;

  @override
  Future<ImpactSummary> impact({String? il, String? ilce}) async {
    final answer = await _api.get(
      'impact',
      query: {'il': il, 'ilce': il == null ? null : ilce},
      auth: AuthScope.none,
    );
    return parse<ImpactSummary>(() => ImpactSummary.fromJson(objectOf(answer)));
  }
}

class DioPushRepository implements PushRepository {
  new(this._api);

  final ApiClient _api;

  @override
  Future<void> registerToken(String platform, String token) async {
    await _api.put(
      'me/push-token',
      data: {'platform': platform, 'token': token},
    );
  }
}
