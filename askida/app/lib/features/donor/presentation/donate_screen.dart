import 'dart:async';

import 'package:askida/core/webview/checkout_webview.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/donation.dart';
import 'package:askida/data/models/item.dart';
import 'package:askida/data/models/money.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/typography.dart';
import 'package:askida/features/auth/presentation/widgets/form_parts.dart';
import 'package:askida/features/donor/domain/donation_rules.dart';
import 'package:askida/features/donor/presentation/donor_providers.dart';
import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:askida/routing/app_mode.dart';
import 'package:askida/routing/app_paths.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Builds the payment page. The default is the allowlisted
/// [CheckoutWebView]; tests replace it (the platform view needs a device).
typedef CheckoutViewBuilder = Widget Function({
  required Uri checkoutUrl,
  required void Function(String donationId, String? status) onResult,
  required VoidCallback onBlockedStart,
});

final checkoutViewBuilderProvider = Provider<CheckoutViewBuilder>(
  (ref) =>
      ({required checkoutUrl, required onResult, required onBlockedStart}) =>
          CheckoutWebView(
            checkoutUrl: checkoutUrl,
            onResult: onResult,
            onBlockedStart: onBlockedStart,
          ),
);

/// `/donor/donate?shop=<slug>&item=<id>`: quantity (1-20) of one item,
/// the total the server will charge and the limits of one payment, then
/// `POST donations` and the provider's payment page in the allowlisted
/// WebView. The pay page sends the app back with
/// `askida://donation/<id>?status=`, which opens the receipt.
class DonateScreen extends ConsumerWidget {
  const new({required this.shopSlug, required this.itemId, super.key});

  final String shopSlug;
  final String itemId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final shop = ref.watch(donorShopProvider(shopSlug));
    void back() => context.canPop()
        ? context.pop()
        : context.go(AppPaths.shop(AppMode.donor, shopSlug));
    return shop.when(
      data: (details) {
        final public = details is PublicShopDetails ? details.shop : null;
        final item = public?.items.where((i) => i.id == itemId).firstOrNull;
        if (public == null || item == null) {
          return FormScreen(
            title: l10n.donateTitle,
            onBack: back,
            children: [
              MessageBanner(message: l10n.donateItemGone, error: true),
            ],
          );
        }
        return _DonateFlow(
          key: ValueKey('${public.id}/${item.id}'),
          shop: public,
          item: item,
          onBack: back,
        );
      },
      loading: () => Scaffold(
        appBar: AppBar(
          title: Text(l10n.donateTitle),
          leading: BackButton(onPressed: back),
        ),
        body: const Center(child: CircularProgressIndicator()),
      ),
      error: (error, _) => FormScreen(
        title: l10n.donateTitle,
        onBack: back,
        children: [
          if (error is ApiProblem)
            ProblemBanner(problem: error)
          else
            MessageBanner(message: l10n.problemGeneric, error: true),
          formGapSmall,
          TextButton(
            onPressed: () => ref.invalidate(donorShopProvider(shopSlug)),
            child: Text(l10n.donorRetry),
          ),
        ],
      ),
    );
  }
}

class _DonateFlow extends ConsumerStatefulWidget {
  const new({
    required this.shop,
    required this.item,
    required this.onBack,
    super.key,
  });

  final PublicShop shop;
  final PublicItem item;
  final VoidCallback onBack;

  @override
  ConsumerState<_DonateFlow> createState() => _DonateFlowState();
}

class _DonateFlowState extends ConsumerState<_DonateFlow> {
  int _qty = 1;
  bool _busy = false;
  ApiProblem? _problem;
  DonationCheckout? _checkout;
  bool _checkoutBlocked = false;

  int get _price => widget.item.priceMinor;
  int get _maxQty => DonationRules.maxQtyFor(_price);

  Future<void> _start() async {
    setState(() {
      _busy = true;
      _problem = null;
    });
    try {
      final checkout = await ref
          .read(donationsRepositoryProvider)
          .create(widget.shop.id, widget.item.id, _qty);
      if (mounted) setState(() => _checkout = checkout);
    } on ApiProblem catch (problem) {
      if (mounted) setState(() => _problem = problem);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _finished(String donationId, String? status) {
    if (!mounted) return;
    context.go(AppPaths.donation(donationId, status: status));
  }

  Future<void> _leaveCheckout() async {
    final checkout = _checkout;
    if (checkout == null) return;
    final l10n = context.l10n;
    final leave = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.donateLeaveTitle),
        content: Text(l10n.donateLeaveBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.donateLeaveStay),
          ),
          TextButton(
            key: const ValueKey('donate-leave-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.donateLeaveConfirm),
          ),
        ],
      ),
    );
    if ((leave ?? false) && mounted) {
      context.go(AppPaths.donation(checkout.donationId));
    }
  }

  @override
  Widget build(BuildContext context) {
    final checkout = _checkout;
    if (checkout != null) return _checkoutView(context, checkout);
    return _form(context);
  }

  Widget _checkoutView(BuildContext context, DonationCheckout checkout) {
    final l10n = context.l10n;
    final url = Uri.tryParse(checkout.checkoutUrl);
    final blocked = _checkoutBlocked || url == null;
    final builder = ref.watch(checkoutViewBuilderProvider);
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_leaveCheckout());
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.donateCheckoutTitle),
          leading: IconButton(
            key: const ValueKey('checkout-close'),
            tooltip: l10n.donateLeaveConfirm,
            icon: const Icon(Icons.close),
            onPressed: () => unawaited(_leaveCheckout()),
          ),
        ),
        body: blocked
            ? ListView(
                padding: const EdgeInsets.all(AskidaLayout.screenGutter),
                children: [
                  MessageBanner(
                    key: const ValueKey('checkout-blocked'),
                    message: l10n.donateCheckoutBlocked,
                    error: true,
                  ),
                  formGap,
                  BusyButton(
                    label: l10n.donateSeeStatus,
                    onPressed: () =>
                        context.go(AppPaths.donation(checkout.donationId)),
                  ),
                ],
              )
            : builder(
                checkoutUrl: url,
                onResult: _finished,
                onBlockedStart: () {
                  if (mounted) setState(() => _checkoutBlocked = true);
                },
              ),
      ),
    );
  }

  Widget _form(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final c = AskidaColors.of(context);
    final locale = l10n.localeName;
    final problem = _problem;
    final total = DonationRules.totalMinor(_price, _qty);
    final limit = qtyLimitFor(_price, _qty);
    final canPay = _maxQty >= 1;
    return FormScreen(
      title: l10n.donateTitle,
      onBack: widget.onBack,
      children: [
        Text(widget.shop.name, style: theme.textTheme.titleMedium),
        Text(
          '${widget.item.name} · ${Money(_price).format(locale)}',
          style: theme.textTheme.bodyLarge,
        ),
        const SizedBox(height: AskidaSpacing.s6),
        if (problem != null) ...[ProblemBanner(problem: problem), formGap],
        Text(l10n.donateQtyLabel, style: theme.textTheme.titleMedium),
        formGapSmall,
        _QtyStepper(
          qty: _qty,
          max: _maxQty,
          enabled: !_busy && canPay,
          onChanged: (qty) => setState(() {
            _qty = qty;
            _problem = null;
          }),
        ),
        formGapSmall,
        if (!canPay)
          MessageBanner(message: _txCapText(l10n), error: true)
        else if (limit != QtyLimit.none)
          Text(
            limit == QtyLimit.transactionCap
                ? _txCapText(l10n)
                : l10n.donateMaxUnits(DonationRules.maxQty),
            key: const ValueKey('donate-limit'),
            style: theme.textTheme.bodySmall?.copyWith(color: c.textMuted),
          ),
        const SizedBox(height: AskidaSpacing.s6),
        Semantics(
          label: l10n.donateTotalLabel(Money(total).format(locale)),
          excludeSemantics: true,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: Text(
                  l10n.donateTotal,
                  style: theme.textTheme.titleMedium,
                ),
              ),
              Flexible(
                child: Text(
                  Money(total).format(locale),
                  key: const ValueKey('donate-total'),
                  textAlign: TextAlign.end,
                  style: AskidaTypography.numeral.copyWith(color: c.text),
                ),
              ),
            ],
          ),
        ),
        formGapSmall,
        Text(
          l10n.donateDailyCapNote(
            const Money(DonationRules.perDayCapMinor).format(locale),
          ),
          style: theme.textTheme.bodySmall?.copyWith(color: c.textMuted),
        ),
        formGapSmall,
        Text(
          l10n.donateHowItWorks,
          style: theme.textTheme.bodySmall?.copyWith(color: c.textMuted),
        ),
        const SizedBox(height: AskidaSpacing.s6),
        BusyButton(
          key: const ValueKey('donate-pay'),
          label: l10n.donatePayAction,
          busy: _busy,
          onPressed: canPay ? () => unawaited(_start()) : null,
        ),
      ],
    );
  }

  String _txCapText(AppLocalizations l10n) => l10n.donateTxCap(
    const Money(DonationRules.perTransactionCapMinor).format(l10n.localeName),
  );
}

class _QtyStepper extends StatelessWidget {
  const new({
    required this.qty,
    required this.max,
    required this.enabled,
    required this.onChanged,
  });

  final int qty;
  final int max;
  final bool enabled;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final c = AskidaColors.of(context);
    final canDown = enabled && qty > DonationRules.minQty;
    final canUp = enabled && qty < max;
    return Semantics(
      label: l10n.donateQtyValue(qty),
      child: Row(
        children: [
          IconButton.filledTonal(
            key: const ValueKey('qty-minus'),
            tooltip: l10n.donateQtyLess,
            onPressed: canDown ? () => onChanged(qty - 1) : null,
            icon: const Icon(Icons.remove),
          ),
          Expanded(
            child: Text(
              '$qty',
              key: const ValueKey('qty-value'),
              textAlign: TextAlign.center,
              style: AskidaTypography.numeral.copyWith(color: c.text),
            ),
          ),
          IconButton.filledTonal(
            key: const ValueKey('qty-plus'),
            tooltip: l10n.donateQtyMore,
            onPressed: canUp ? () => onChanged(qty + 1) : null,
            icon: const Icon(Icons.add),
          ),
        ],
      ),
    );
  }
}
