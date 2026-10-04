import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/donation.dart';
import 'package:askida/data/repositories/donations_repository.dart';

import '../helpers/fixtures.dart';
import 'scriptable.dart';

/// In-memory [DonationsRepository]. [create] records an `initiated`
/// donation and answers a checkout URL on `https://askida.app/pay/`.
class FakeDonationsRepository with Scriptable implements DonationsRepository {
  new({List<Donation>? donations})
    : donations =
          donations ?? fixtureList('donations').map(Donation.fromJson).toList();

  /// Newest first.
  final List<Donation> donations;

  /// Price per unit used for created donations (kuruş).
  int unitPriceMinor = 1500;

  @override
  Future<DonationCheckout> create(String shopId, String itemId, int qty) async {
    record('create');
    final id = 'donation-${donations.length + 1}';
    donations.insert(
      0,
      Donation(
        id: id,
        shopId: shopId,
        itemId: itemId,
        qty: qty,
        amountMinor: unitPriceMinor * qty,
        status: DonationStatus.initiated,
      ),
    );
    return DonationCheckout(
      donationId: id,
      checkoutUrl: 'https://askida.app/pay/sample-checkout-$id',
    );
  }

  @override
  Future<DonationPage> list({String? cursor}) async {
    record('list');
    return DonationPage(donations: List.unmodifiable(donations));
  }

  @override
  Future<Donation> byId(String id) async {
    record('byId');
    for (final donation in donations) {
      if (donation.id == id) return donation;
    }
    throw const ApiProblem(code: 'not_found', status: 404);
  }

  /// Simulates the payment confirmation the server would record.
  void markPaid(String id) {
    final index = donations.indexWhere((d) => d.id == id);
    donations[index] = donations[index].copyWith(
      status: DonationStatus.paid,
      paidAt: DateTime.utc(2026, 10, 4, 6, 20),
    );
  }
}
