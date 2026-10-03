import 'package:askida/app.dart';
import 'package:askida/core/env/app_env.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

void main() {
  final env = AppEnv.fromEnvironment();
  runApp(
    ProviderScope(
      overrides: [appEnvProvider.overrideWithValue(env)],
      child: const AskidaApp(),
    ),
  );
}
