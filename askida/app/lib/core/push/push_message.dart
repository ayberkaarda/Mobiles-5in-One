import 'package:askida/routing/app_paths.dart';
import 'package:flutter/foundation.dart';
import 'package:go_router/go_router.dart';

/// A push notification as the app sees it. The server sends `title`,
/// `body` and string `data`; no payload ever carries recipient data.
@immutable
class PushMessage {
  const new({this.title, this.body, this.data = const {}});

  /// Builds a message from a transport payload (`{title, body, data}` or a
  /// flat data map). Non-string values are turned into strings.
  factory fromPayload(Map<String, Object?> payload) {
    final rawData = payload['data'];
    final source = rawData is Map
        ? rawData
        : {
            for (final e in payload.entries)
              if (e.key != 'title' && e.key != 'body') e.key: e.value,
          };
    final data = <String, String>{
      for (final e in source.entries)
        if (e.value != null) '${e.key}': '${e.value}',
    };
    return PushMessage(
      title: payload['title'] as String?,
      body: payload['body'] as String?,
      data: data,
    );
  }

  final String? title;
  final String? body;
  final Map<String, String> data;
}

/// What a push is about, from its `type` data value (openapi `PushData`).
enum PushKind {
  /// `{type: hooks.issued, shop_id, item, count}`: "Yeni askı" to the
  /// owner and staff of the shop.
  newHooks,

  /// `{type: hook.redeemed, donation_id, shop_id, item, shop}`: "Askın
  /// alındı" to the donor whose unit was collected.
  redeemed,

  unknown,
}

/// Classifies [message] by its `type`. Messages without a known type (an
/// older server, another sender) are [PushKind.unknown].
PushKind pushKindOf(PushMessage message) => switch (message.data['type']) {
  'hooks.issued' => PushKind.newHooks,
  'hook.redeemed' => PushKind.redeemed,
  _ => PushKind.unknown,
};

final RegExp _uuid = RegExp(
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-'
  r'[0-9a-fA-F]{12}$',
);

/// Where tapping [message] opens: `hooks.issued` -> the merchant's
/// redemptions list; `hook.redeemed` -> the donation `donation_id` (the
/// donation history when the id is missing or not a UUID, so nothing else
/// is ever used as a path). Unknown pushes open nothing (null).
String? routeForPush(PushMessage message) => switch (pushKindOf(message)) {
  PushKind.newHooks => AppPaths.merchantRedemptions,
  PushKind.redeemed => switch (message.data['donation_id']) {
    final String id when _uuid.hasMatch(id) => AppPaths.donation(id),
    _ => AppPaths.donorDonations,
  },
  PushKind.unknown => null,
};

/// Opens the screen of a tapped [message] in [router] (no-op for unknown
/// pushes). The guards still apply.
void openPush(GoRouter router, PushMessage message) {
  final location = routeForPush(message);
  if (location != null) router.go(location);
}
