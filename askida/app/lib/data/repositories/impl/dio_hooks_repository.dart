import 'package:askida/core/http/api_client.dart';
import 'package:askida/data/models/reservation.dart';
import 'package:askida/data/repositories/hooks_repository.dart';
import 'package:askida/data/repositories/impl/json_body.dart';

class DioHooksRepository implements HooksRepository {
  new(this._api);

  final ApiClient _api;

  @override
  Future<Reservation> reserve(String shopId, String itemId) async {
    final answer = await _api.post(
      'hooks/reserve',
      data: {'shop_id': shopId, 'item_id': itemId},
      auth: AuthScope.anon,
    );
    return parse<Reservation>(() => Reservation.fromJson(objectOf(answer)));
  }

  @override
  Future<RedeemResult> redeem(String shopId, String code) async {
    final answer = await _api.post(
      'shops/$shopId/redeem',
      data: {'code': code},
    );
    return parse<RedeemResult>(() => RedeemResult.fromJson(objectOf(answer)));
  }

  @override
  Future<RedemptionDay> redemptions(String shopId, {DateTime? day}) async {
    final answer = await _api.get(
      'shops/$shopId/redemptions',
      query: {'day': day == null ? null : isoDay(day)},
    );
    return parse<RedemptionDay>(() {
      final rows = listOf(answer).map(Redemption.fromJson).toList();
      final meta = metaOf(answer);
      return RedemptionDay(
        day: meta['day'] as String? ?? (day == null ? '' : isoDay(day)),
        count: meta['count'] as int? ?? rows.length,
        redemptions: rows,
      );
    });
  }
}
