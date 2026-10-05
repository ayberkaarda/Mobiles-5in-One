import 'package:askida/core/platform/media_picker.dart';
import 'package:askida/core/time/clock.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/item.dart';
import 'package:askida/data/models/payout.dart';
import 'package:askida/data/models/reservation.dart';
import 'package:askida/data/models/shop_document.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/features/merchant/domain/merchant_shop.dart';
import 'package:askida/features/merchant/domain/redemption_code.dart';
import 'package:askida/features/merchant/domain/redemption_days.dart';
import 'package:askida/features/merchant/domain/shop_rules.dart';
import 'package:askida/features/merchant/presentation/providers/merchant_shop_controller.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show FutureProviderFamily;

Future<MerchantShop> _requireShop(Ref ref) async {
  final shop = await ref.watch(merchantShopProvider.future);
  if (shop == null) throw const ApiProblem(code: 'not_found', status: 404);
  return shop;
}

// ------------------------------------------------------------------ catalog

/// The shop's catalog, inactive items included (owner and staff may read).
final catalogProvider = AsyncNotifierProvider<CatalogController, List<Item>>(
  CatalogController.new,
  retry: noRetry,
);

class CatalogController extends AsyncNotifier<List<Item>> {
  @override
  Future<List<Item>> build() async {
    final shop = await _requireShop(ref);
    return await ref.read(shopsRepositoryProvider).items(shop.id);
  }

  Future<String> _shopId() async =>
      (await ref.read(merchantShopProvider.future))?.id ??
      (throw const ApiProblem(code: 'not_found', status: 404));

  /// `POST shops/{id}/items`; the new item is appended.
  Future<Item> add(ItemDraft draft) async {
    final item = await ref
        .read(shopsRepositoryProvider)
        .createItem(await _shopId(), draft);
    state = AsyncData([...?state.value, item]);
    return item;
  }

  /// `PATCH shops/{id}/items/{itemId}` with the changed fields only.
  Future<Item> save(String itemId, ItemDraft changes) async {
    final item = await ref
        .read(shopsRepositoryProvider)
        .updateItem(await _shopId(), itemId, changes);
    state = AsyncData([
      for (final existing in state.value ?? const <Item>[])
        if (existing.id == itemId) item else existing,
    ]);
    return item;
  }

  Future<Item> setActive(Item item, {required bool active}) =>
      save(item.id, ItemDraft(active: active));
}

// --------------------------------------------------------------- redemptions

/// One day of the redemption log as the list shows it.
@immutable
class RedemptionLogView {
  const new({required this.rows, this.offline = false});

  /// Newest first: item and time (and the member role), nothing else.
  final List<Redemption> rows;

  /// The server could not be reached; rows come from the device log only.
  final bool offline;
}

/// Redemptions of one day: fetched from the server and added to the
/// on-device log (kept 30 days), then read back from the log so a day
/// stays visible offline.
final FutureProviderFamily<RedemptionLogView, LogDay> redemptionLogProvider =
    FutureProvider.autoDispose.family<RedemptionLogView, LogDay>((
      ref,
      day,
    ) async {
      final shop = await _requireShop(ref);
      final db = ref.watch(appDatabaseProvider);
      await db.purgeExpired(ref.read(clockProvider)());
      var offline = false;
      try {
        final answer = await ref
            .read(hooksRepositoryProvider)
            .redemptions(shop.id, day: day.start);
        await db.logRedemptions(shop.id, answer.redemptions);
      } on ApiProblem catch (problem) {
        if (!problem.code.startsWith('network.')) rethrow;
        offline = true;
      }
      final rows = await db.redemptionsBetween(shop.id, day.start, day.end);
      return RedemptionLogView(rows: rows, offline: offline);
    }, retry: noRetry);

// ------------------------------------------------------------------ payouts

/// Per-day payout ledger (owner only).
final FutureProvider<List<Payout>> payoutsProvider =
    FutureProvider.autoDispose<List<Payout>>((ref) async {
      final shop = await _requireShop(ref);
      final rows = await ref.read(payoutsRepositoryProvider).payouts(shop.id);
      return [...rows]..sort((a, b) => b.day.compareTo(a.day));
    }, retry: noRetry);

// ------------------------------------------------------------------- redeem

/// Where the redemption screen is.
sealed class RedeemState {
  const new();
}

final class RedeemIdle extends RedeemState {
  const new();
}

final class RedeemBusy extends RedeemState {
  const new(this.code);
  final String code;
}

final class RedeemDone extends RedeemState {
  const new(this.result);
  final RedeemResult result;
}

/// [problem] is null when the input could not be a code at all.
final class RedeemFailed extends RedeemState {
  const new([this.problem]);
  final ApiProblem? problem;
}

final NotifierProvider<RedeemController, RedeemState> redeemControllerProvider =
    NotifierProvider.autoDispose<RedeemController, RedeemState>(
      RedeemController.new,
    );

class RedeemController extends Notifier<RedeemState> {
  @override
  RedeemState build() => const RedeemIdle();

  /// Sends [raw] (scanned or typed). Ignored while a code is in flight or
  /// a result is on screen, so a camera that keeps seeing the same QR
  /// cannot redeem twice.
  Future<void> submit(String raw) async {
    if (state is! RedeemIdle && state is! RedeemFailed) return;
    final code = RedemptionCode.normalise(raw);
    if (code == null) {
      state = const RedeemFailed();
      return;
    }
    final shop = ref.read(merchantShopProvider).value;
    if (shop == null) {
      state = const RedeemFailed(ApiProblem(code: 'not_found', status: 404));
      return;
    }
    state = RedeemBusy(code);
    try {
      final result = await ref
          .read(hooksRepositoryProvider)
          .redeem(shop.id, code);
      try {
        await ref.read(appDatabaseProvider).logRedemptions(shop.id, [
          Redemption(
            item: result.item,
            redeemedAt: result.redeemedAt,
            redeemedByRole: shop.role.name,
          ),
        ]);
      } on Object {
        // The server holds the record; the device log catches up on the
        // next list fetch.
      }
      if (!ref.mounted) return;
      ref.invalidate(redemptionLogProvider);
      state = RedeemDone(result);
    } on ApiProblem catch (problem) {
      if (!ref.mounted) return;
      state = RedeemFailed(problem);
    }
  }

  /// Back to scanning.
  void reset() => state = const RedeemIdle();
}

// ---------------------------------------------------------------- documents

/// Why a document upload stopped.
enum DocumentFailure { type, size, picker, limit }

@immutable
class DocumentsState {
  const new({
    this.uploaded = const [],
    this.busy = false,
    this.failure,
    this.problem,
  });

  /// Documents confirmed in this session (the API has no listing yet).
  final List<ShopDocument> uploaded;
  final bool busy;
  final DocumentFailure? failure;
  final ApiProblem? problem;

  DocumentsState copyWith({
    List<ShopDocument>? uploaded,
    bool? busy,
    DocumentFailure? failure,
    ApiProblem? problem,
  }) => DocumentsState(
    uploaded: uploaded ?? this.uploaded,
    busy: busy ?? this.busy,
    failure: failure,
    problem: problem,
  );
}

final NotifierProvider<DocumentsController, DocumentsState>
documentsControllerProvider =
    NotifierProvider.autoDispose<DocumentsController, DocumentsState>(
      DocumentsController.new,
    );

class DocumentsController extends Notifier<DocumentsState> {
  @override
  DocumentsState build() => const DocumentsState();

  /// Picks a photo, then presign -> PUT to the presigned URL -> confirm.
  Future<void> upload(DocumentKind kind, DocumentSource source) async {
    if (state.busy) return;
    if (state.uploaded.length >= ShopRules.maxDocuments) {
      state = state.copyWith(failure: DocumentFailure.limit);
      return;
    }
    final shop = ref.read(merchantShopProvider).value;
    if (shop == null) return;
    PickedDocument? picked;
    try {
      picked = await ref.read(mediaPickerProvider).pickDocument(source: source);
    } on UnsupportedDocument catch (error) {
      state = state.copyWith(
        failure: error.reason == 'size'
            ? DocumentFailure.size
            : DocumentFailure.type,
      );
      return;
    } on Exception {
      state = state.copyWith(failure: DocumentFailure.picker);
      return;
    }
    if (picked == null || !ref.mounted) return;
    state = state.copyWith(busy: true);
    final shops = ref.read(shopsRepositoryProvider);
    try {
      final presigned = await shops.presignDocument(
        shop.id,
        kind: kind,
        mime: picked.mime,
        size: picked.size,
      );
      await shops.uploadDocument(
        Uri.parse(presigned.upload.url),
        picked.bytes,
        picked.mime,
        headers: presigned.upload.headers,
      );
      final confirmed = await shops.confirmDocument(
        shop.id,
        presigned.document.id,
      );
      if (!ref.mounted) return;
      state = DocumentsState(uploaded: [...state.uploaded, confirmed]);
    } on ApiProblem catch (problem) {
      if (!ref.mounted) return;
      state = state.copyWith(busy: false, problem: problem);
    }
  }
}
