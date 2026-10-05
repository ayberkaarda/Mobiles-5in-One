import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Sources produced by build_runner must stay out of version control.
final _builtSource = RegExp(r'\.(g|freezed|drift|mocks)\.dart$');

void main() {
  test('no build_runner output is tracked by git', () async {
    final result = await Process.run('git', ['ls-files', '--', '.']);
    expect(result.exitCode, 0, reason: '${result.stderr}');
    final tracked = (result.stdout as String)
        .split('\n')
        .map((line) => line.trim())
        .where((line) => line.isNotEmpty)
        .toList();
    expect(tracked, isNotEmpty, reason: 'git ls-files listed nothing');
    expect(tracked.where(_builtSource.hasMatch), isEmpty);
  });

  test('the ignore file lists every build_runner suffix', () {
    final ignore = File('.gitignore').readAsLinesSync();
    for (final pattern in ['*.g.dart', '*.freezed.dart', '*.drift.dart']) {
      expect(ignore, contains(pattern));
    }
  });
}
