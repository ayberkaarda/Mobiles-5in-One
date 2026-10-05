package app.cetele.server.support

import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap

/**
 * Fixture phone numbers, built at run time as `+9055` followed by eight random digits. They are
 * valid Turkish mobile numbers for validation (`@E164Tr`) and unique within one test run, so
 * tests sharing the database never collide.
 */
object TestUsers {
    private const val PREFIX = "+9055"
    private const val DIGITS = 8
    private val random = SecureRandom()
    private val issued = ConcurrentHashMap.newKeySet<String>()

    fun phone(): String {
        while (true) {
            val digits = (1..DIGITS).joinToString("") { random.nextInt(10).toString() }
            val candidate = PREFIX + digits
            if (issued.add(candidate)) return candidate
        }
    }

    /** The masked form the API and the logs use for [phone]: `+90*******` plus the last two digits. */
    fun masked(phone: String): String = "+90*******" + phone.takeLast(2)
}
