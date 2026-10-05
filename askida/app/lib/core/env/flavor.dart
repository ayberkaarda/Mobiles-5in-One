import 'package:flutter/services.dart' show appFlavor;
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Flavor passed as `--dart-define=ASKIDA_FLAVOR=dev` (or `prod`).
const String kFlavorDefine = String.fromEnvironment('ASKIDA_FLAVOR');

/// True only when the build was told it is the dev flavor through the
/// compile-time define.
const bool kIsDevFlavor = kFlavorDefine == 'dev';

/// Whether this run is the dev flavor: the `ASKIDA_FLAVOR` define, or the
/// flavor Flutter itself records for `--flavor dev` builds. Anything else
/// (including an unknown or missing flavor) counts as prod, so dev-only
/// fallbacks stay off by default.
bool resolveDevFlavor({String define = kFlavorDefine, String? flutterFlavor}) =>
    define == 'dev' || (define.isEmpty && flutterFlavor == 'dev');

/// Tests override this; production reads the build.
final devFlavorProvider = Provider<bool>(
  // `appFlavor` is a compile-time value set by `flutter build --flavor`;
  // the analyzer sees it as null, so it looks redundant but must stay.
  // ignore: avoid_redundant_argument_values
  (ref) => resolveDevFlavor(flutterFlavor: appFlavor),
);
