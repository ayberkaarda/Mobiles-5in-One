import 'package:askida/data/session.dart';
import 'package:askida/features/discovery/presentation/coarse_location.dart';
import 'package:askida/features/recipient/presentation/location_step.dart';
import 'package:askida/features/recipient/presentation/nearby_shops_view.dart';
import 'package:askida/features/recipient/presentation/onboarding_intro.dart';
import 'package:askida/features/recipient/presentation/recipient_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Home of "Askıdan al", reachable from the first screen with no account.
///
/// Three onboarding screens, no account wall: (1) the station rail and one
/// sentence, (2) an approximate location or a district, (3) the nearby
/// shops, which then stays the home. Screen 1 is skipped once this device
/// has an anonymous identity; screens 1 and 2 are skipped when location
/// permission is already granted (the position is read coarse and rounded).
class RecipientHomeScreen extends ConsumerStatefulWidget {
  const new({super.key});

  @override
  ConsumerState<RecipientHomeScreen> createState() =>
      _RecipientHomeScreenState();
}

class _RecipientHomeScreenState extends ConsumerState<RecipientHomeScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _checkLocation());
  }

  Future<void> _checkLocation() async {
    if (!mounted || ref.read(coarseLocationProvider).point != null) return;
    try {
      await ref.read(coarseLocationProvider.notifier).check();
    } on Object {
      // No location plugin on this platform: the location step offers the
      // district picker.
    }
  }

  @override
  Widget build(BuildContext context) {
    final location = ref.watch(coarseLocationProvider);
    final point = location.point;
    if (point != null) return NearbyShopsView(point: point);

    final introSeen = ref.watch(recipientIntroSeenProvider);
    final returning = ref.watch(sessionProvider.select((s) => s.hasAnonToken));
    if (!introSeen && !returning) {
      return OnboardingIntro(
        onStart: () => ref.read(recipientIntroSeenProvider.notifier).seen(),
      );
    }
    return const LocationStep();
  }
}
