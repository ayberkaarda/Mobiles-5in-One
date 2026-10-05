import 'package:askida/design/tokens.dart';
import 'package:askida/design/widgets/mode_switcher.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:askida/routing/app_mode.dart';
import 'package:askida/routing/app_paths.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// Scaffold shared by the three modes; the mode switcher at the top changes
/// mode and each mode keeps its own navigation stack. The app bar's
/// settings action opens language, theme and account settings from every
/// mode, without an account.
class ModeShell extends StatelessWidget {
  const new({required this.navigationShell, super.key});

  final StatefulNavigationShell navigationShell;

  AppMode get currentMode => AppMode.values[navigationShell.currentIndex];

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.appTitle),
        actions: [
          IconButton(
            key: const ValueKey('shell-settings'),
            tooltip: l10n.settingsTitle,
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => context.push(AppPaths.settings),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AskidaLayout.screenGutter,
              AskidaSpacing.s2,
              AskidaLayout.screenGutter,
              AskidaSpacing.s2,
            ),
            child: ModeSwitcher(
              selected: currentMode,
              onChanged: (mode) => navigationShell.goBranch(
                mode.index,
                initialLocation: mode.index == navigationShell.currentIndex,
              ),
            ),
          ),
          Expanded(child: navigationShell),
        ],
      ),
    );
  }
}
