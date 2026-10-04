/// Call log and scripted failures shared by the in-memory fakes.
///
/// ```dart
/// final shops = FakeShopsRepository()
///   ..failNext('nearby', const ApiProblem(code: 'x', status: 0));
/// ```
mixin Scriptable {
  /// Method names in call order.
  final List<String> calls = [];

  final Map<String, List<Exception>> _queued = {};
  final Map<String, Exception> _always = {};

  /// The next call of [method] throws [error] (queue; one per call).
  void failNext(String method, Exception error) =>
      (_queued[method] ??= []).add(error);

  /// Every call of [method] throws [error] until [clearFailures].
  void failAlways(String method, Exception error) => _always[method] = error;

  void clearFailures() {
    _queued.clear();
    _always.clear();
  }

  int callCount(String method) => calls.where((c) => c == method).length;

  /// Records the call and throws a scripted failure if one is due.
  void record(String method) {
    calls.add(method);
    final queue = _queued[method];
    if (queue != null && queue.isNotEmpty) throw queue.removeAt(0);
    final always = _always[method];
    if (always != null) throw always;
  }
}
