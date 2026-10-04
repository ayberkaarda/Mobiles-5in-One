/// One-time codes as the merchant types or scans them.
///
/// Codes are 8 characters from a Crockford-style alphabet. People read
/// them aloud and type them on a phone, so input is forgiving: spaces and
/// dashes are dropped, lowercase letters are accepted and the look-alikes
/// `I`/`L` -> `1` and `O` -> `0` are folded, the same way the server
/// normalises them. Casing is done on ASCII code units only (Dart's
/// `toUpperCase` is not locale-aware and the app never calls it).
abstract final class RedemptionCode {
  static const int length = 8;

  static final RegExp _separators = RegExp(r'[\s\-_.]');
  static final RegExp _allowed = RegExp(r'^[0-9A-Z]+$');

  /// ASCII-only uppercase: `a`-`z` become `A`-`Z`, everything else stays.
  static String asciiUpper(String input) => String.fromCharCodes(
    input.codeUnits.map((u) => u >= 0x61 && u <= 0x7A ? u - 0x20 : u),
  );

  /// The canonical form of [input], or null when it cannot be a code
  /// (wrong length or characters outside the alphabet).
  static String? normalise(String input) {
    final folded = asciiUpper(input.trim().replaceAll(_separators, ''))
        .replaceAll(RegExp('[IL]'), '1')
        .replaceAll('O', '0');
    if (folded.length != length || !_allowed.hasMatch(folded)) return null;
    return folded;
  }

  /// `K7M2QX9R` -> `K7M2 QX9R` (groups of four, as the code tag shows it).
  static String grouped(String code) =>
      code.length <= 4 ? code : '${code.substring(0, 4)} ${code.substring(4)}';
}
