import 'dart:async';

import 'package:askida/core/env/app_env.dart';
import 'package:askida/core/env/flavor.dart';
import 'package:askida/routing/deep_links.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// Payment provider hosts the checkout form may load (iyzico's documented
/// API, static and checkout-form hosts, live and sandbox). Not verified
/// against a live account: no sandbox account (ADR-0006).
const Set<String> iyzicoHosts = {
  'api.iyzipay.com',
  'sandbox-api.iyzipay.com',
  'static.iyzipay.com',
  'sandbox-static.iyzipay.com',
  'cpp.iyzipay.com',
  'sandbox-cpp.iyzipay.com',
};

/// What the checkout WebView does with a navigation.
sealed class CheckoutNavigation {
  const new();
}

final class CheckoutAllow extends CheckoutNavigation {
  const new();
}

final class CheckoutBlock extends CheckoutNavigation {
  const new();
}

/// The pay page sent the app back: `askida://donation/<id>?status=`.
@immutable
final class CheckoutFinished extends CheckoutNavigation {
  const new(this.donationId, this.status);

  final String donationId;
  final String? status;

  @override
  bool operator ==(Object other) =>
      other is CheckoutFinished &&
      other.donationId == donationId &&
      other.status == status;

  @override
  int get hashCode => Object.hash(donationId, status);
}

/// The allowlist (contract): `https://askida.app/pay/*`, the [iyzicoHosts]
/// over https, and in the dev flavor only the configured API origin's
/// `/pay/*`. Blank subframes are allowed (payment forms use them); every
/// other navigation is blocked.
CheckoutNavigation decideCheckoutNavigation(
  Uri uri, {
  required bool devFlavor,
  required Uri apiBaseUrl,
  bool isMainFrame = true,
}) {
  if (uri.scheme == 'askida') {
    final link = parseDeepLink(uri);
    return link is DonationReturnLink
        ? CheckoutFinished(link.donationId, link.status)
        : const CheckoutBlock();
  }
  if (!isMainFrame && uri.toString() == 'about:blank') {
    return const CheckoutAllow();
  }
  final noCredentials = uri.userInfo.isEmpty;
  if (uri.scheme == 'https' && noCredentials) {
    final defaultPort = !uri.hasPort || uri.port == 443;
    if (uri.host == 'askida.app' && defaultPort && _isPayPath(uri)) {
      return const CheckoutAllow();
    }
    if (iyzicoHosts.contains(uri.host) && defaultPort) {
      return const CheckoutAllow();
    }
  }
  if (devFlavor &&
      noCredentials &&
      uri.scheme == apiBaseUrl.scheme &&
      uri.host == apiBaseUrl.host &&
      uri.port == apiBaseUrl.port &&
      _isPayPath(uri)) {
    return const CheckoutAllow();
  }
  return const CheckoutBlock();
}

bool _isPayPath(Uri uri) =>
    uri.path.startsWith('/pay/') && !uri.pathSegments.contains('..');

/// Applies [decideCheckoutNavigation] to WebView requests and reports the
/// return link once.
class CheckoutNavigationPolicy {
  new({
    required this.devFlavor,
    required this.apiBaseUrl,
    required this.onResult,
  });

  final bool devFlavor;
  final Uri apiBaseUrl;
  final void Function(String donationId, String? status) onResult;
  bool _finished = false;

  NavigationDecision handle(NavigationRequest request) {
    final uri = Uri.tryParse(request.url);
    if (uri == null) return NavigationDecision.prevent;
    final decision = decideCheckoutNavigation(
      uri,
      devFlavor: devFlavor,
      apiBaseUrl: apiBaseUrl,
      isMainFrame: request.isMainFrame,
    );
    switch (decision) {
      case CheckoutAllow():
        return NavigationDecision.navigate;
      case CheckoutBlock():
        return NavigationDecision.prevent;
      case CheckoutFinished(:final donationId, :final status):
        if (!_finished) {
          _finished = true;
          onResult(donationId, status);
        }
        return NavigationDecision.prevent;
    }
  }
}

/// The payment page. Loads [checkoutUrl] (only when it passes the
/// allowlist), blocks every other navigation and calls [onResult] when the
/// pay page returns `askida://donation/<id>?status=`. The receipt screen
/// must re-read the donation: the status in the link is a hint only.
///
/// The platform view itself is not unit tested; the policy is.
class CheckoutWebView extends ConsumerStatefulWidget {
  const new({
    required this.checkoutUrl,
    required this.onResult,
    this.onBlockedStart,
    super.key,
  });

  final Uri checkoutUrl;
  final void Function(String donationId, String? status) onResult;

  /// Called instead of loading when [checkoutUrl] is not allowed.
  final VoidCallback? onBlockedStart;

  @override
  ConsumerState<CheckoutWebView> createState() => _CheckoutWebViewState();
}

class _CheckoutWebViewState extends ConsumerState<CheckoutWebView> {
  WebViewController? _controller;

  @override
  void initState() {
    super.initState();
    final devFlavor = ref.read(devFlavorProvider);
    final apiBaseUrl = ref.read(appEnvProvider).apiBaseUrl;
    final start = decideCheckoutNavigation(
      widget.checkoutUrl,
      devFlavor: devFlavor,
      apiBaseUrl: apiBaseUrl,
    );
    if (start is! CheckoutAllow) {
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => widget.onBlockedStart?.call(),
      );
      return;
    }
    final policy = CheckoutNavigationPolicy(
      devFlavor: devFlavor,
      apiBaseUrl: apiBaseUrl,
      onResult: widget.onResult,
    );
    final controller = WebViewController();
    _controller = controller;
    unawaited(_load(controller, policy));
  }

  /// The delegate is installed before the first request, so even the
  /// first redirect goes through the allowlist.
  Future<void> _load(
    WebViewController controller,
    CheckoutNavigationPolicy policy,
  ) async {
    // The provider's checkout form needs scripts.
    await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
    await controller.setNavigationDelegate(
      NavigationDelegate(onNavigationRequest: policy.handle),
    );
    await controller.loadRequest(widget.checkoutUrl);
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    if (controller == null) return const SizedBox.shrink();
    return WebViewWidget(controller: controller);
  }
}
