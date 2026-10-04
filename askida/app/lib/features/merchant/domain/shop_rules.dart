/// Client-side checks for the shop and catalog forms. They mirror the
/// server rules so most mistakes are caught before a round trip; the server
/// stays the authority (its field errors are shown the same way).
library;

/// Why a field was refused. Screens map these to copy.
enum FieldIssue { required, tooShort, tooLong, invalid, outOfRange }

abstract final class ShopRules {
  static const int nameMin = 2;
  static const int nameMax = 120;
  static const int addressMin = 5;
  static const int addressMax = 255;
  static const int placeMin = 2;
  static const int placeMax = 64;

  /// Up to three verification documents per shop (spec story 2).
  static const int maxDocuments = 3;

  static FieldIssue? text(String value, {required int min, required int max}) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) return FieldIssue.required;
    if (trimmed.length < min) return FieldIssue.tooShort;
    if (trimmed.length > max) return FieldIssue.tooLong;
    if (trimmed.contains('\n')) return FieldIssue.invalid;
    return null;
  }

  /// `+90XXXXXXXXXX` from the shapes the server accepts (`+90…`, `90…`,
  /// `0…`, ten digits), or null.
  static String? normalisePhone(String input) {
    final digits = input.replaceAll(RegExp(r'[\s().\-]'), '');
    final match = RegExp(r'^(?:\+?90|0)?([2-589]\d{9})$').firstMatch(digits);
    return match == null ? null : '+90${match.group(1)}';
  }

  static FieldIssue? phone(String input) {
    if (input.trim().isEmpty) return FieldIssue.required;
    return normalisePhone(input) == null ? FieldIssue.invalid : null;
  }

  /// Ten digits (the server also checks the tax number checksum).
  static FieldIssue? taxNumber(String input) {
    final digits = input.replaceAll(RegExp(r'\s'), '');
    if (digits.isEmpty) return FieldIssue.required;
    return RegExp(r'^\d{10}$').hasMatch(digits) ? null : FieldIssue.invalid;
  }

  static String normaliseTaxNumber(String input) =>
      input.replaceAll(RegExp(r'\s'), '');

  /// `TR` + 24 digits without spaces; letters are folded to ASCII capitals.
  static String normaliseIban(String input) {
    final compact = input.replaceAll(RegExp(r'\s'), '');
    return String.fromCharCodes(
      compact.codeUnits.map((u) => u >= 0x61 && u <= 0x7A ? u - 0x20 : u),
    );
  }

  /// A Turkish IBAN: `TR`, 24 digits, valid ISO 7064 mod-97 checksum.
  static FieldIssue? iban(String input) {
    final iban = normaliseIban(input);
    if (iban.isEmpty) return FieldIssue.required;
    if (!RegExp(r'^TR\d{24}$').hasMatch(iban)) return FieldIssue.invalid;
    final rearranged = '${iban.substring(4)}${iban.substring(0, 4)}';
    var remainder = 0;
    for (final unit in rearranged.codeUnits) {
      // Letters count as 10..35, digits as themselves.
      final value = unit >= 0x41 ? unit - 0x41 + 10 : unit - 0x30;
      for (final digit in '$value'.codeUnits) {
        remainder = (remainder * 10 + (digit - 0x30)) % 97;
      }
    }
    return remainder == 1 ? null : FieldIssue.invalid;
  }
}

abstract final class ItemRules {
  static const int nameMax = 120;

  /// Prices in kuruş (₺1,00 - ₺10.000,00).
  static const int minPriceMinor = 100;
  static const int maxPriceMinor = 1000000;
  static const int maxDailyCap = 1000;

  /// Parses a price typed as `15`, `15,5`, `15,50`, `1.234,50` or `15.50`
  /// into kuruş, with integer arithmetic only. Null when it is not a price.
  static int? parsePriceMinor(String input) {
    var text = input.replaceAll(RegExp(r'[\s₺]'), '');
    if (text.isEmpty) return null;
    final comma = text.lastIndexOf(',');
    final dot = text.lastIndexOf('.');
    String whole;
    var fraction = '';
    if (comma >= 0) {
      // Turkish: dots group thousands, the comma separates kuruş.
      whole = text.substring(0, comma).replaceAll('.', '');
      fraction = text.substring(comma + 1);
    } else if (dot >= 0 && text.length - dot - 1 <= 2) {
      whole = text.substring(0, dot);
      fraction = text.substring(dot + 1);
    } else {
      whole = text.replaceAll('.', '');
    }
    if (!RegExp(r'^\d+$').hasMatch(whole) ||
        !RegExp(r'^\d{0,2}$').hasMatch(fraction) ||
        whole.length > 7) {
      return null;
    }
    text = fraction.padRight(2, '0');
    return int.parse(whole) * 100 + int.parse(text);
  }

  /// `1550` -> `15,50` (the form shows prices without the symbol).
  static String priceInput(int minor, {String decimal = ','}) =>
      '${minor ~/ 100}$decimal${(minor % 100).toString().padLeft(2, '0')}';

  static FieldIssue? name(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) return FieldIssue.required;
    if (trimmed.length > nameMax) return FieldIssue.tooLong;
    return null;
  }

  static FieldIssue? price(String input) {
    if (input.trim().isEmpty) return FieldIssue.required;
    final minor = parsePriceMinor(input);
    if (minor == null) return FieldIssue.invalid;
    if (minor < minPriceMinor || minor > maxPriceMinor) {
      return FieldIssue.outOfRange;
    }
    return null;
  }

  static FieldIssue? dailyCap(String input) {
    if (input.trim().isEmpty) return FieldIssue.required;
    final value = int.tryParse(input.trim());
    if (value == null) return FieldIssue.invalid;
    if (value < 1 || value > maxDailyCap) return FieldIssue.outOfRange;
    return null;
  }
}
