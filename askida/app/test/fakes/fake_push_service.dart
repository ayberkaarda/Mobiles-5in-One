import 'dart:async';

import 'package:askida/core/push/push_message.dart';
import 'package:askida/core/push/push_service.dart';

/// [PushService] driven by the test: set [nextToken], call [deliver].
class FakePushService implements PushService {
  new({this.nextToken});

  /// Token that [init] makes available (null = no transport/permission).
  String? nextToken;
  String? _token;
  int inits = 0;

  final StreamController<PushMessage> _messages =
      StreamController<PushMessage>.broadcast();

  void deliver(PushMessage message) => _messages.add(message);

  Future<void> close() => _messages.close();

  @override
  Future<void> init() async {
    inits++;
    _token = nextToken;
  }

  @override
  String? get token => _token;

  @override
  Stream<PushMessage> get onMessage => _messages.stream;
}
