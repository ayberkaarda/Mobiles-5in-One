package app.cetele.server.auth.integrity

import app.cetele.server.config.LocalOnlyAdapterGuard
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.env.Environment

/**
 * Selects the integrity verifier from `CETELE_INTEGRITY_MODE` (`cetele.integrity.mode`):
 * `fake` is allowed only in the local and test profiles; `play` is the Google client of Phase 4
 * and is refused until it exists. An empty mode means `fake` in local/test and is a startup
 * error anywhere else.
 */
@Configuration(proxyBeanMethods = false)
class IntegrityConfiguration {
    @Bean
    fun integrityPolicy(environment: Environment): IntegrityPolicy = IntegrityPolicy(packageName(environment))

    @Bean
    fun integrityVerifier(environment: Environment): IntegrityVerifier {
        val mode = environment.getProperty(MODE_PROPERTY).orEmpty().trim()
        return when {
            mode == MODE_FAKE || (mode.isEmpty() && LocalOnlyAdapterGuard.isAllowed(environment)) -> {
                LocalOnlyAdapterGuard.check(FakeIntegrityVerifier.ADAPTER_NAME, environment)
                FakeIntegrityVerifier(packageName(environment))
            }

            mode == MODE_PLAY -> {
                error("integrity mode play needs the Play Integrity client, which is not part of this build")
            }

            mode.isEmpty() -> {
                error("CETELE_INTEGRITY_MODE must be set")
            }

            else -> {
                error("unknown CETELE_INTEGRITY_MODE")
            }
        }
    }

    private fun packageName(environment: Environment): String =
        environment
            .getProperty(PACKAGE_PROPERTY)
            .orEmpty()
            .trim()
            .ifEmpty { DEFAULT_PACKAGE }

    companion object {
        /** Bound from `CETELE_INTEGRITY_MODE`. */
        const val MODE_PROPERTY = "cetele.integrity.mode"

        /** Bound from `CETELE_PLAY_PACKAGE_NAME`. */
        const val PACKAGE_PROPERTY = "cetele.play.package-name"
        const val MODE_FAKE = "fake"
        const val MODE_PLAY = "play"
        const val DEFAULT_PACKAGE = "app.cetele.android"
    }
}
