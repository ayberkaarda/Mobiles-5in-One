import 'package:askida/data/models/impact_summary.dart';

/// Public impact counters. Throws `ApiProblem`.
abstract interface class ImpactRepository {
  /// `GET impact?il=&ilce=` (no token). [ilce] needs [il]; the server may
  /// roll a small district up to the province or the country.
  Future<ImpactSummary> impact({String? il, String? ilce});
}
