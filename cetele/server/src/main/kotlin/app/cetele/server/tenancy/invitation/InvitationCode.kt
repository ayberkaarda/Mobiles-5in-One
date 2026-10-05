package app.cetele.server.tenancy.invitation

import java.security.SecureRandom

/**
 * Invitation codes: 8 characters of Crockford base32 (`0-9` and `A-Z` without `I L O U`), 40 bits
 * from [SecureRandom]. Only the keyed hash ([InvitationCodeHasher]) is stored. Input is read leniently the Crockford way: lowercase
 * is accepted and `I`/`L` read as `1`, `O` as `0`.
 */
object InvitationCode {
    const val LENGTH = 8
    const val ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

    private val random = SecureRandom()

    fun generate(): String {
        val chars = CharArray(LENGTH) { ALPHABET[random.nextInt(ALPHABET.length)] }
        return String(chars)
    }

    /** Canonical form of [input], or `null` when it cannot be a code. */
    fun normalize(input: String): String? {
        if (input.length != LENGTH) return null
        val canonical =
            input
                .uppercase()
                .map { char ->
                    when (char) {
                        'I', 'L' -> '1'
                        'O' -> '0'
                        else -> char
                    }
                }.joinToString("")
        return canonical.takeIf { code -> code.all { it in ALPHABET } }
    }
}
