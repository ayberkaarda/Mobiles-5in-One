import 'package:askida/l10n/l10n.dart';
import 'package:askida/routing/app_mode.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// Scaffold shared by the three modes; the bottom bar switches mode and each
/// mode keeps its own navigation stack.
class ModeShell extends StatelessWidget {
  const new({required this.navigationShell, super.key});

  final StatefulNavigationShell navigationShell;

  AppMode get currentMode => AppMode.values[navigationShell.currentIndex];

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(currentMode.label(l10n))),
      body: navigationShell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: navigationShell.currentIndex,
        onDestinationSelected: (index) => navigationShell.goBranch(
          index,
          initialLocation: index == navigationShell.currentIndex,
        ),
        destinations: [
          for (final mode in AppMode.values)
            NavigationDestination(
              key: ValueKey('mode-${mode.name}'),
              icon: Icon(mode.icon),
              label: mode.label(l10n),
            ),
        ],
      ),
    );
  }
}
