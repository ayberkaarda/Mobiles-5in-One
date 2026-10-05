package app.cetele.server.config

import org.springframework.core.env.Environment

/**
 * The single gate for every stand-in adapter (fake integrity verifier, fake SMS gateway,
 * ephemeral JWT keys, OTP local echo). A stand-in is allowed only when the active profiles
 * contain `local` or `test`; anywhere else the application context fails to start.
 */
object LocalOnlyAdapterGuard {
    val ALLOWED_PROFILES: Set<String> = setOf("local", "test")

    fun isAllowed(activeProfiles: Collection<String>): Boolean = activeProfiles.any { it in ALLOWED_PROFILES }

    /** Throws [IllegalStateException] unless [activeProfiles] allow stand-in adapters. */
    fun check(
        adapterName: String,
        activeProfiles: Collection<String>,
    ) {
        check(isAllowed(activeProfiles)) {
            "fake adapter $adapterName is not allowed in profiles ${activeProfiles.joinToString(", ", "[", "]")}"
        }
    }

    fun check(
        adapterName: String,
        environment: Environment,
    ) = check(adapterName, environment.activeProfiles.toList())

    fun isAllowed(environment: Environment): Boolean = isAllowed(environment.activeProfiles.toList())
}
