import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Failure categories of the `askida/attest` platform channel.
enum AttestFailure {
  /// The platform build has no attestation provider wired in.
  unsupported,

  /// The provider exists but could not produce a token right now.
  unavailable,

  /// Anything the app does not know how to classify.
  unknown;

  static AttestFailure fromCode(String code) => switch (code) {
    'unsupported' => AttestFailure.unsupported,
    'unavailable' => AttestFailure.unavailable,
    _ => AttestFailure.unknown,
  };
}

class AttestException implements Exception {
  const new(this.failure, this.message);

  final AttestFailure failure;
  final String message;

  @override
  String toString() => 'AttestException(${failure.name}): $message';
}

/// Dart side of the device attestation channel (Play Integrity on Android,
/// DeviceCheck on iOS). The native sides currently answer `unsupported`.
class AttestChannel {
  new({MethodChannel? channel})
    : _channel = channel ?? const MethodChannel(channelName);

  static const channelName = 'askida/attest';
  static const requestTokenMethod = 'requestToken';

  final MethodChannel _channel;

  /// Returns an attestation token or throws [AttestException].
  ///
  /// [nonce] is the `device_nonce` the server will check; the native side
  /// binds the provider request to it (passed as the `nonce` argument).
  Future<String> requestToken({String? nonce}) async {
    try {
      final token = await _channel.invokeMethod<String>(
        requestTokenMethod,
        nonce == null ? null : <String, String>{'nonce': nonce},
      );
      if (token == null || token.isEmpty) {
        throw const AttestException(
          AttestFailure.unknown,
          'The platform returned an empty attestation token.',
        );
      }
      return token;
    } on PlatformException catch (error) {
      throw AttestException(
        AttestFailure.fromCode(error.code),
        error.message ?? error.code,
      );
    } on MissingPluginException {
      throw const AttestException(
        AttestFailure.unsupported,
        'No attestation handler is registered on this platform.',
      );
    }
  }
}

final attestChannelProvider = Provider<AttestChannel>((ref) => AttestChannel());
