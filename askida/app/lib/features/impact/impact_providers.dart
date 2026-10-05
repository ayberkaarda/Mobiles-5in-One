import 'package:askida/data/models/donation.dart';
import 'package:askida/data/models/impact_summary.dart';
import 'package:askida/data/providers.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';

/// The area an impact summary is asked for; both null = the whole country.
@immutable
class ImpactArea {
  const new({this.il, this.ilce});

  final String? il;
  final String? ilce;

  @override
  bool operator ==(Object other) =>
      other is ImpactArea && other.il == il && other.ilce == ilce;

  @override
  int get hashCode => Object.hash(il, ilce);
}

/// Public counters (`GET impact`): units left on and taken from the rail
/// today and the shops taking part. No account needed.
final FutureProviderFamily<ImpactSummary, ImpactArea> impactSummaryProvider =
    FutureProvider.autoDispose.family<ImpactSummary, ImpactArea>(
      (ref, area) => ref
          .watch(impactRepositoryProvider)
          .impact(il: area.il, ilce: area.ilce),
      retry: _noRetry,
    );

/// The donor's own numbers, from their paid donations: units left on the
/// rail and the shops they went to. Counts of items only; nobody who took
/// one is ever known to the app.
@immutable
class DonorImpact {
  const new({required this.units, required this.shops});

  factory fromDonations(Iterable<Donation> donations) {
    var units = 0;
    final shops = <String>{};
    for (final donation in donations) {
      if (donation.status != DonationStatus.paid) continue;
      units += donation.qty;
      shops.add(donation.shopId);
    }
    return DonorImpact(units: units, shops: shops.length);
  }

  final int units;
  final int shops;
}

/// [DonorImpact] of the first page of the donor's history (the newest
/// donations); the history screen shows the complete list.
final FutureProvider<DonorImpact> donorImpactProvider =
    FutureProvider.autoDispose<DonorImpact>((ref) async {
      final page = await ref.watch(donationsRepositoryProvider).list();
      return DonorImpact.fromDonations(page.donations);
    }, retry: _noRetry);

/// The card is secondary: a failed load says so once and is not retried
/// in the background.
Duration? _noRetry(int retryCount, Object error) => null;
