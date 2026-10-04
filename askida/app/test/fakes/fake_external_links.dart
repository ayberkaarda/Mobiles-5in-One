import 'package:askida/core/links/external_links.dart';

/// Records links; applies the same allowlist as the real implementation.
class FakeExternalLinks implements ExternalLinks {
  final List<Uri> opened = [];
  final List<Uri> refused = [];

  @override
  Future<bool> open(Uri uri) async {
    if (!isAllowedExternalLink(uri)) {
      refused.add(uri);
      return false;
    }
    opened.add(uri);
    return true;
  }
}
