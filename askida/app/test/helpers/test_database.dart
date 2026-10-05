import 'package:askida/data/db/app_database.dart';
import 'package:drift/drift.dart';
import 'package:drift/native.dart';

/// A fresh in-memory database; close it in `tearDown`.
AppDatabase testDatabase() {
  // Several test files open their own in-memory database in one isolate.
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
  return AppDatabase(NativeDatabase.memory());
}
