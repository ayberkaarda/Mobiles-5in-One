import 'package:askida/data/models/donation.dart';

/// Donor donations (Phase 3 API). Every method throws `ApiProblem`.
abstract interface class DonationsRepository {
  /// `POST donations` with `{shop_id, item_id, qty}` only; the server
  /// computes the amount and answers the checkout URL for the WebView.
  Future<DonationCheckout> create(String shopId, String itemId, int qty);

  /// `GET donations?cursor=` (own donations, newest first).
  Future<DonationPage> list({String? cursor});

  /// `GET donations/{id}` (own only).
  Future<Donation> byId(String id);
}
