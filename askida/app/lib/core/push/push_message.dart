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

  /// Title of the merchant notification for new units on the rail.
  static const newHooksTitle = 'Yeni askı';

  /// Title of the donor notification when a unit was collected.
  static const redeemedTitle = 'Askın alındı';
}

/// What a push is about.
enum PushKind { newHooks, redeemed, unknown }

/// Classifies [message]. An explicit `type` (`hooks.issued`,
/// `hook.redeemed`) wins; otherwise the shapes the server sends today:
/// new hooks carry `item` + `count`, a collected unit `item` + `shop`.
PushKind pushKindOf(PushMessage message) {
  final type = message.data['type'];
  if (type == 'hooks.issued') return PushKind.newHooks;
  if (type == 'hook.redeemed') return PushKind.redeemed;
  final data = message.data;
  if (message.title == PushMessage.newHooksTitle ||
      (data.containsKey('item') && data.containsKey('count'))) {
    return PushKind.newHooks;
  }
  if (message.title == PushMessage.redeemedTitle ||
      (data.containsKey('item') && data.containsKey('shop'))) {
    return PushKind.redeemed;
  }
  return PushKind.unknown;
}

/// Where tapping [message] opens: merchant 'Yeni askı' -> the redemptions
/// list, donor 'Askın alındı' -> the donation (by `donation_id` when sent,
/// else the donation history). Unknown pushes open nothing (null).
String? routeForPush(PushMessage message) => switch (pushKindOf(message)) {
  PushKind.newHooks => AppPaths.merchantRedemptions,
  PushKind.redeemed => switch (message.data['donation_id']) {
    final String id when RegExp(r'^[A-Za-z0-9-]{1,64}$').hasMatch(id) =>
      AppPaths.donation(id),
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
