import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/features/merchant/merchant_paths.dart';
import 'package:askida/features/merchant/presentation/providers/merchant_shop_controller.dart';
import 'package:askida/features/merchant/presentation/widgets/merchant_page.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Links an existing shop to this device: staff of a shop, or an owner
/// on a new phone. The shop address (`askida.app/dukkan/<ad>`) or its
/// short name is enough; membership is checked by the server.
class LinkShopScreen extends ConsumerStatefulWidget {
  const new({super.key});

  @override
  ConsumerState<LinkShopScreen> createState() => _LinkShopScreenState();
}

class _LinkShopScreenState extends ConsumerState<LinkShopScreen> {
  final _input = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final l10n = context.l10n;
    if (slugFromInput(_input.text) == null) {
      setState(() => _error = l10n.merchantLinkInvalid);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(merchantShopProvider.notifier).link(_input.text);
      if (!mounted) return;
      context.go(MerchantPaths.home);
    } on NotShopMember {
      if (!mounted) return;
      setState(() => _error = l10n.merchantLinkNotMember);
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _error = errorMessage(l10n, error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    return MerchantPage(
      title: l10n.merchantLinkShop,
      child: ListView(
        padding: const EdgeInsets.all(AskidaLayout.screenGutter),
        children: [
          Text(
            l10n.merchantLinkBody,
            style: theme.textTheme.bodyLarge?.copyWith(
              color: AskidaColors.of(context).textMuted,
            ),
          ),
          const SizedBox(height: AskidaSpacing.s4),
          TextField(
            key: const ValueKey('link-input'),
            controller: _input,
            autocorrect: false,
            keyboardType: TextInputType.url,
            textInputAction: TextInputAction.done,
            onSubmitted: (_) => _submit(),
            decoration: InputDecoration(
              labelText: l10n.merchantLinkField,
              helperText: l10n.merchantLinkFieldHint,
              helperMaxLines: 3,
              errorText: _error,
              errorMaxLines: 3,
            ),
          ),
          const SizedBox(height: AskidaSpacing.s4),
          FilledButton(
            key: const ValueKey('link-submit'),
            onPressed: _busy ? null : _submit,
            child: Text(_busy ? l10n.merchantSending : l10n.merchantLinkSubmit),
          ),
        ],
      ),
    );
  }
}
