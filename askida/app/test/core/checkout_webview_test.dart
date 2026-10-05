import 'package:askida/core/env/app_env.dart';
import 'package:askida/core/env/flavor.dart';
import 'package:askida/core/webview/checkout_webview.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:webview_flutter/webview_flutter.dart';

void main() {
  final devApi = Uri.parse('http://10.0.2.2:58080/api/v1');

  CheckoutNavigation decide(
    String url, {
    bool dev = false,
    bool mainFrame = true,
  }) => decideCheckoutNavigation(
    Uri.parse(url),
    devFlavor: dev,
    apiBaseUrl: devApi,
    isMainFrame: mainFrame,
  );

  group('allowlist', () {
    test('the pay page and the provider hosts are allowed', () {
      for (final url in [
        'https://askida.app/pay/sample-checkout-0031',
        'https://askida.app/pay/callback',
        'https://sandbox-api.iyzipay.com/payment/iyzipos/checkoutform',
        'https://static.iyzipay.com/checkoutform/v2/bundle.js',
        'https://cpp.iyzipay.com/?token=x',
      ]) {
        expect(decide(url), isA<CheckoutAllow>(), reason: url);
      }
    });

    test('everything else is blocked', () {
      for (final url in [
        'https://askida.app/',
        'https://askida.app/dukkan/ornek',
        'https://askida.app/pay/../admin',
        'http://askida.app/pay/x',
        'https://askida.app:8443/pay/x',
        'https://user@askida.app/pay/x',
        'https://evil.example/pay/x',
        'https://iyzipay.com.evil.example/',
        'http://sandbox-api.iyzipay.com/',
        'javascript:alert(1)',
        'data:text/html,hi',
        'intent://x#Intent;end',
        'about:blank',
        'askida://shop/ornek',
        // The local stack only in the dev flavor:
        'http://10.0.2.2:58080/pay/x',
      ]) {
        expect(decide(url), isA<CheckoutBlock>(), reason: url);
      }
    });

    test('dev flavor allows only the API origin /pay/*', () {
      expect(
        decide('http://10.0.2.2:58080/pay/x', dev: true),
        isA<CheckoutAllow>(),
      );
      expect(
        decide('http://10.0.2.2:58080/api/v1/me', dev: true),
        isA<CheckoutBlock>(),
      );
      expect(
        decide('http://10.0.2.2:9999/pay/x', dev: true),
        isA<CheckoutBlock>(),
      );
      expect(
        decide('http://localhost:58080/pay/x', dev: true),
        isA<CheckoutBlock>(),
      );
    });

    test('blank subframes are allowed, a blank main frame is not', () {
      expect(decide('about:blank', mainFrame: false), isA<CheckoutAllow>());
      expect(decide('about:blank'), isA<CheckoutBlock>());
    });

    test('the return link finishes with id and status', () {
      expect(
        decide('askida://donation/abc-1?status=paid'),
        const CheckoutFinished('abc-1', 'paid'),
      );
      expect(
        decide('askida://donation/abc-1'),
        const CheckoutFinished('abc-1', null),
      );
    });
  });

  test('the policy maps decisions and reports the result once', () {
    final results = <(String, String?)>[];
    final policy = CheckoutNavigationPolicy(
      devFlavor: false,
      apiBaseUrl: devApi,
      onResult: (id, status) => results.add((id, status)),
    );
    NavigationDecision go(String url, {bool main = true}) =>
        policy.handle(NavigationRequest(url: url, isMainFrame: main));

    expect(go('https://askida.app/pay/t'), NavigationDecision.navigate);
    expect(go('https://evil.example/'), NavigationDecision.prevent);
    expect(go('not a url %%%'), NavigationDecision.prevent);
    expect(
      go('askida://donation/abc-1?status=failed'),
      NavigationDecision.prevent,
    );
    expect(
      go('askida://donation/abc-1?status=failed'),
      NavigationDecision.prevent,
    );
    expect(results, [('abc-1', 'failed')]);
  });

  testWidgets('a disallowed checkout URL is never loaded', (tester) async {
    var blocked = 0;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          appEnvProvider.overrideWithValue(AppEnv(apiBaseUrl: devApi)),
          devFlavorProvider.overrideWithValue(false),
        ],
        child: MaterialApp(
          home: CheckoutWebView(
            checkoutUrl: Uri.parse('https://evil.example/pay/x'),
            onResult: (_, _) {},
            onBlockedStart: () => blocked++,
          ),
        ),
      ),
    );
    await tester.pump();

    expect(blocked, 1);
    expect(find.byType(WebViewWidget), findsNothing);
  });
}
