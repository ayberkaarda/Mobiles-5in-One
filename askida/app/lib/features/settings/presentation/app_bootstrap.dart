import 'dart:async';

import 'package:askida/core/push/push_message.dart';
import 'package:askida/data/session.dart';
import 'package:askida/features/settings/presentation/settings_controller.dart';
import 'package:askida/routing/app_router.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// App-wide start-up work that belongs to the settings: restores the
/// remembered language and theme, starts push, registers the push token
/// whenever an account signs in, and opens the screen of a tapped
/// notification (merchant 'Yeni askı' -> redemptions, donor 'Askın alındı'
/// -> the donation). Deep links are subscribed by the router itself.
class AppBootstrap extends ConsumerStatefulWidget {
  const new({required this.child, super.key});

  final Widget child;

  @override
  ConsumerState<AppBootstrap> createState() => _AppBootstrapState();
}

class _AppBootstrapState extends ConsumerState<AppBootstrap> {
  @override
  void initState() {
    super.initState();
    unawaited(ref.read(settingsActionsProvider).restore());
    unawaited(
      ref
          .read(pushControllerProvider.notifier)
          .start((message) => openPush(ref.read(appRouterProvider), message)),
    );
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(
      sessionProvider.select((session) => session.user?.id),
      (_, _) => unawaited(ref.read(pushControllerProvider.notifier).sync()),
    );
    return widget.child;
  }
}
