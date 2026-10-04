import 'package:askida/core/http/api_client.dart';
import 'package:askida/data/models/donation.dart';
import 'package:askida/data/repositories/donations_repository.dart';
import 'package:askida/data/repositories/impl/json_body.dart';

class DioDonationsRepository implements DonationsRepository {
  new(this._api);

  final ApiClient _api;

  @override
  Future<DonationCheckout> create(String shopId, String itemId, int qty) async {
    final answer = await _api.post(
      'donations',
      data: {'shop_id': shopId, 'item_id': itemId, 'qty': qty},
    );
    return parse<DonationCheckout>(
      () => DonationCheckout.fromJson(objectOf(answer)),
    );
  }

  @override
  Future<DonationPage> list({String? cursor}) async {
    final answer = await _api.get('donations', query: {'cursor': cursor});
    return parse<DonationPage>(
      () => DonationPage(
        donations: listOf(answer).map(Donation.fromJson).toList(),
        nextCursor: metaOf(answer)['next_cursor'] as String?,
      ),
    );
  }

  @override
  Future<Donation> byId(String id) async {
    final answer = await _api.get('donations/$id');
    return parse<Donation>(() => Donation.fromJson(objectOf(answer)));
  }
}
