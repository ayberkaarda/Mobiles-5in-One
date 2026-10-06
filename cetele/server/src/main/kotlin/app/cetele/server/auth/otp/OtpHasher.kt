package app.cetele.server.auth.otp

import app.cetele.server.config.LocalOnlyAdapterGuard
import org.slf4j.LoggerFactory
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.env.Environment
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * `HMAC-SHA256(pepper, phone || code)`. The phone has a fixed E.164 shape and the code exactly six
 * digits, so the plain concatenation is unambiguous. Comparison is constant time.
 */
class OtpHasher(
    pepper: ByteArray,
) {
    private val key = SecretKeySpec(pepper.copyOf(), ALGORITHM)

    init {
        require(pepper.size >= MIN_PEPPER_BYTES) { "OTP pepper must be at least $MIN_PEPPER_BYTES bytes" }
    }

    fun hmac(
        phoneE164: String,
        code: String,
    ): ByteArray = Mac.getInstance(ALGORITHM).apply { init(key) }.doFinal((phoneE164 + code).toByteArray(Charsets.UTF_8))

    fun matches(
        phoneE164: String,
        code: String,
        expected: ByteArray,
    ): Boolean = MessageDigest.isEqual(hmac(phoneE164, code), expected)

    override fun toString(): String = "OtpHasher(pepper=<masked>)"

    companion object {
        const val ALGORITHM = "HmacSHA256"
        const val MIN_PEPPER_BYTES = 32
    }
}

/**
 * OTP settings. `CETELE_OTP_PEPPER` (`cetele.otp.pepper`, at least 32 bytes) is required outside
 * local/test; there an empty value means a random pepper built at startup. `CETELE_OTP_LOCAL_ECHO`
 * (`cetele.otp.local-echo`) writes the SMS text to the log and is refused outside local/test.
 */
@Configuration(proxyBeanMethods = false)
class OtpConfiguration {
    private val log = LoggerFactory.getLogger(OtpConfiguration::class.java)

    @Bean
    fun otpHasher(environment: Environment): OtpHasher {
        val pepper = environment.getProperty(PEPPER_PROPERTY).orEmpty()
        if (pepper.isNotEmpty()) {
            check(pepper.toByteArray(Charsets.UTF_8).size >= OtpHasher.MIN_PEPPER_BYTES) {
                "CETELE_OTP_PEPPER must be at least ${OtpHasher.MIN_PEPPER_BYTES} bytes"
            }
            return OtpHasher(pepper.toByteArray(Charsets.UTF_8))
        }
        LocalOnlyAdapterGuard.check(RANDOM_PEPPER_ADAPTER, environment)
        log.warn("Using a random OTP pepper; codes issued before a restart cannot be verified after it")
        return OtpHasher(ByteArray(OtpHasher.MIN_PEPPER_BYTES).also { SecureRandom().nextBytes(it) })
    }

    @Bean
    fun otpSettings(environment: Environment): OtpSettings {
        val localEcho = environment.getProperty(LOCAL_ECHO_PROPERTY, Boolean::class.java, false)
        if (localEcho) {
            LocalOnlyAdapterGuard.check(LOCAL_ECHO_ADAPTER, environment)
            log.warn("OTP local echo is on: SMS texts are written to the log")
        }
        return OtpSettings(localEcho = localEcho)
    }

    companion object {
        /** Bound from `CETELE_OTP_PEPPER`. */
        const val PEPPER_PROPERTY = "cetele.otp.pepper"

        /** Bound from `CETELE_OTP_LOCAL_ECHO`. */
        const val LOCAL_ECHO_PROPERTY = "cetele.otp.local-echo"
        const val RANDOM_PEPPER_ADAPTER = "random-otp-pepper"
        const val LOCAL_ECHO_ADAPTER = "otp-local-echo"
    }
}

data class OtpSettings(
    val localEcho: Boolean,
)
