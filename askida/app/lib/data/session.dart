import 'package:askida/data/models/user.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// What the app knows about who is using it right now. The account [user]
/// is kept in memory only (tokens live in the secure store).
@immutable
class SessionState {
  const new({
    this.user,
    this.hasUserToken = false,
    this.hasAnonToken = false,
    this.restored = false,
  });

  /// Signed-in donor or merchant, once `me` or a sign-in answered.
  final User? user;

  /// A user token is stored (the user may not be loaded yet, e.g. offline).
  final bool hasUserToken;

  /// An anonymous device token is stored (recipient mode).
  final bool hasAnonToken;

  /// [SessionController.restored] has run since launch.
  final bool restored;

  bool get isSignedIn => user != null && hasUserToken;
  bool get isMerchant => isSignedIn && user!.kind == UserKind.merchant;
  bool get isDonor => isSignedIn && user!.kind == UserKind.donor;

  SessionState copyWith({
    User? user,
    bool clearUser = false,
    bool? hasUserToken,
    bool? hasAnonToken,
    bool? restored,
  }) => SessionState(
    user: clearUser ? null : user ?? this.user,
    hasUserToken: hasUserToken ?? this.hasUserToken,
    hasAnonToken: hasAnonToken ?? this.hasAnonToken,
    restored: restored ?? this.restored,
  );

  @override
  bool operator ==(Object other) =>
      other is SessionState &&
      other.user == user &&
      other.hasUserToken == hasUserToken &&
      other.hasAnonToken == hasAnonToken &&
      other.restored == restored;

  @override
  int get hashCode => Object.hash(user, hasUserToken, hasAnonToken, restored);
}

/// Receives session changes from the repositories and the HTTP client, so
/// no feature has to remember to update the session after a call.
abstract interface class SessionSink {
  void signedIn(User user);
  void userUpdated(User user);
  void signedOut();
  void anonStored();
  void anonCleared();
}

/// A sink that drops every event (repositories used outside the app).
class NoopSessionSink implements SessionSink {
  const new();

  @override
  void signedIn(User user) {}
  @override
  void userUpdated(User user) {}
  @override
  void signedOut() {}
  @override
  void anonStored() {}
  @override
  void anonCleared() {}
}

/// Holds [SessionState]; the guards and every mode read it.
class SessionController extends Notifier<SessionState> implements SessionSink {
  @override
  SessionState build() => const SessionState();

  /// Marks what the secure store holds at launch. [user] is the result of
  /// `me` when it could be loaded.
  void restored({
    required bool hasUserToken,
    required bool hasAnonToken,
    User? user,
  }) {
    state = SessionState(
      user: hasUserToken ? user : null,
      hasUserToken: hasUserToken,
      hasAnonToken: hasAnonToken,
      restored: true,
    );
  }

  @override
  void signedIn(User user) =>
      state = state.copyWith(user: user, hasUserToken: true);

  @override
  void userUpdated(User user) => state = state.copyWith(user: user);

  @override
  void signedOut() =>
      state = state.copyWith(clearUser: true, hasUserToken: false);

  @override
  void anonStored() => state = state.copyWith(hasAnonToken: true);

  @override
  void anonCleared() => state = state.copyWith(hasAnonToken: false);
}

final sessionProvider = NotifierProvider<SessionController, SessionState>(
  SessionController.new,
);
