import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:askida/routing/app_mode.dart';
import 'package:askida/routing/app_paths.dart';
import 'package:flutter/foundation.dart' show immutable;
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// A link the app understands.
@immutable
sealed class DeepLink {
  const new();
}

/// `askida://shop/<slug>` or `https://askida.app/dukkan/<slug>`.
final class ShopLink extends DeepLink {
  const new(this.slug);

  final String slug;

  @override
  bool operator ==(Object other) => other is ShopLink && other.slug == slug;

  @override
  int get hashCode => slug.hashCode;
}

/// `askida://donation/<id>?status=` (return from the checkout page).
final class DonationReturnLink extends DeepLink {
  const new(this.donationId, this.status);

  final String donationId;

  /// As sent by the pay page (`paid`, `failed`, `pending`); the receipt
  /// screen re-reads the donation and never trusts this value alone.
  final String? status;

  @override
  bool operator ==(Object other) =>
      other is DonationReturnLink &&
      other.donationId == donationId &&
      other.status == status;

  @override
  int get hashCode => Object.hash(donationId, status);
}

final RegExp _slug = RegExp(r'^[a-z0-9][a-z0-9-]{0,190}$');
final RegExp _id = RegExp(r'^[A-Za-z0-9-]{1,64}$');
final RegExp _status = RegExp(r'^[a-z_]{1,32}$');

/// Parses [uri]; anything else (other hosts, schemes, shapes) is null.
DeepLink? parseDeepLink(Uri uri) {
  final segments = uri.pathSegments.where((s) => s.isNotEmpty).toList();
  if (uri.scheme == 'askida') {
    // askida://shop/<slug>: the host is the first part.
    final parts = [uri.host, ...segments];
    if (parts.length == 2 && parts[0] == 'shop' && _slug.hasMatch(parts[1])) {
      return ShopLink(parts[1]);
    }
    if (parts.length == 2 && parts[0] == 'donation' && _id.hasMatch(parts[1])) {
      final status = uri.queryParameters['status'];
      return DonationReturnLink(
        parts[1],
        status != null && _status.hasMatch(status) ? status : null,
      );
    }
    return null;
  }
  if (uri.scheme == 'https' &&
      uri.host == 'askida.app' &&
      segments.length == 2 &&
      segments[0] == 'dukkan' &&
      _slug.hasMatch(segments[1])) {
    return ShopLink(segments[1]);
  }
  return null;
}

/// Where a link opens. Unknown links go to the home of [currentMode]; never
/// a blank screen.
String locationForLink(DeepLink? link, AppMode currentMode) => switch (link) {
  ShopLink(:final slug) => AppPaths.shop(currentMode, slug),
  DonationReturnLink(:final donationId, :final status) => AppPaths.donation(
    donationId,
    status: status,
  ),
  null => currentMode.path,
};

/// Incoming links (initial link included).
abstract interface class DeepLinkSource {
  Stream<Uri> get links;
}

/// [DeepLinkSource] over `app_links`.
class AppLinksSource implements DeepLinkSource {
  new([AppLinks? appLinks]) : _appLinks = appLinks;

  AppLinks? _appLinks;

  @override
  Stream<Uri> get links => (_appLinks ??= AppLinks()).uriLinkStream;
}

/// Tests override with a controllable stream.
final deepLinkSourceProvider = Provider<DeepLinkSource>(
  (ref) => AppLinksSource(),
);
