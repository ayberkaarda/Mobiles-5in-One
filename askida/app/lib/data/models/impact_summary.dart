import 'package:freezed_annotation/freezed_annotation.dart';

part 'impact_summary.freezed.dart';
part 'impact_summary.g.dart';

/// Which area the numbers describe: a district is shown on its own only
/// with enough shops, otherwise the province or the country.
enum ImpactLevel { ilce, il, tr }

/// `GET impact?il=&ilce=` data. Counts of units only, never people.
@freezed
abstract class ImpactSummary with _$ImpactSummary {
  const factory({
    required String day,
    @JsonKey(unknownEnumValue: ImpactLevel.tr) required ImpactLevel level,
    required int donated,
    required int redeemed,
    required int shops,
    required String methodology,
    String? il,
    String? ilce,
  }) = _ImpactSummary;

  factory fromJson(Map<String, dynamic> json) => _$ImpactSummaryFromJson(json);
}
