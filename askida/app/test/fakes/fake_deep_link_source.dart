import 'dart:async';

import 'package:askida/routing/deep_links.dart';

/// [DeepLinkSource] driven by the test: `links.add(Uri.parse(...))`.
class FakeDeepLinkSource implements DeepLinkSource {
  final StreamController<Uri> _controller = StreamController<Uri>.broadcast();

  void add(Uri uri) => _controller.add(uri);

  Future<void> close() => _controller.close();

  @override
  Stream<Uri> get links => _controller.stream;
}
