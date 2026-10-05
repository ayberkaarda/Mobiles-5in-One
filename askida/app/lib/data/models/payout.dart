import 'package:freezed_annotation/freezed_annotation.dart';

part 'payout.freezed.dart';
part 'payout.g.dart';

enum PayoutStatus { pending, paid, held, failed }

/// A per-day row of `GET shops/{id}/payouts` (owner only). The platform
/// commission is shown next to the net amount.
@freezed
abstract class Payout with _$Payout {
  const factory({
    /// Calendar day, `YYYY-MM-DD`.
    required String day,
    required int donatedMinor,
    required int commissionMinor,
    required int netMinor,
    required int redeemedCount,
    @JsonKey(unknownEnumValue: PayoutStatus.pending)
    required PayoutStatus status,
  }) = _Payout;

  factory fromJson(Map<String, dynamic> json) => _$PayoutFromJson(json);
}
