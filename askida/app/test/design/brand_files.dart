import 'dart:convert';
import 'dart:io';

/// The brand package is the single source of design values. Tests run with
/// the app package as the working directory, so the brand folder is a
/// sibling of it.
final Directory brandDir = Directory('../brand');

/// Parsed `brand/tokens.json`.
Map<String, dynamic> readBrandTokens() {
  final file = File('${brandDir.path}/tokens.json');
  return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
}
