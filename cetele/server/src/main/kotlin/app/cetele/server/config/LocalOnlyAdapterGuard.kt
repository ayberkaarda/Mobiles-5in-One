package app.cetele.server.config

import org.springframework.core.env.Environment

/**
 * The single gate for every stand-in adapter (fake integrity verifier, fake SMS gateway,
 * ephemeral JWT keys, OTP local echo). A stand-in is allowed only when the active profiles
 * contain `local` or `test` and none of the production-like profiles; anywhere else, mixed
 * profile lists such as `prod,local` included, the application context fails to start.
 */
object LocalOnlyAdapterGuard {
    val ALLOWED_PROFILES: Set<String> = setOf("local", "test")

    /** Profiles that always mean a real deployment, whatever else is active. */
    val PRODUCTION_LIKE_PROFILES: Set<String> = setOf("prod", "production", "staging", "stage")

    fun isAllowed(activeProfiles: Collection<String>): Boolean =
        activeProfiles.any { it in ALLOWED_PROFILES } && !hasProductionProfile(activeProfiles)

    fun hasProductionProfile(activeProfiles: Collection<String>): Boolean = activeProfiles.any { it in PRODUCTION_LIKE_PROFILES }

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

    /**
     * HTTPS enforcement actually applied: the configured value, but never off while a
     * production-like profile is active (a `local`/`test` profile mixed in cannot relax it).
     */
    fun requireHttps(
        configured: Boolean,
        activeProfiles: Collection<String>,
    ): Boolean = configured || hasProductionProfile(activeProfiles)
}
