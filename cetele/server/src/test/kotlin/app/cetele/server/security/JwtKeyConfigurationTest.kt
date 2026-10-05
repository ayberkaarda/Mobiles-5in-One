package app.cetele.server.security

import app.cetele.server.config.JwtConfiguration
import app.cetele.server.config.JwtProperties
import app.cetele.server.config.LocalOnlyAdapterGuard
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.test.context.assertj.AssertableApplicationContext
import org.springframework.boot.test.context.runner.ApplicationContextRunner
import java.security.KeyPair
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.Base64
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** Key loading for [JwtCodec] and the local-only guard around ephemeral keys. */
class JwtKeyConfigurationTest {
    private val runner =
        ApplicationContextRunner().withUserConfiguration(JwtTestConfiguration::class.java, JwtConfiguration::class.java)

    @Test
    fun `guard allows stand-ins only in local or test profiles`() {
        LocalOnlyAdapterGuard.check("probe", listOf("local"))
        LocalOnlyAdapterGuard.check("probe", listOf("test"))
        LocalOnlyAdapterGuard.check("probe", listOf("local", "debug"))
        val staging = assertFailsWith<IllegalStateException> { LocalOnlyAdapterGuard.check("probe", listOf("staging")) }
        assertEquals("fake adapter probe is not allowed in profiles [staging]", staging.message)
        val none = assertFailsWith<IllegalStateException> { LocalOnlyAdapterGuard.check("probe", emptyList()) }
        assertEquals("fake adapter probe is not allowed in profiles []", none.message)
        assertFailsWith<IllegalStateException> { LocalOnlyAdapterGuard.check("probe", listOf("prod", "localhost")) }
        val mixedProfiles =
            listOf(listOf("prod", "local"), listOf("staging", "test"), listOf("local", "production"), listOf("test", "stage"))
        mixedProfiles.forEach { profiles ->
            val mixed = assertFailsWith<IllegalStateException> { LocalOnlyAdapterGuard.check("probe", profiles) }
            assertEquals("fake adapter probe is not allowed in profiles ${profiles.joinToString(", ", "[", "]")}", mixed.message)
        }
    }

    @Test
    fun `empty keys outside local and test stop the context`() {
        runner.profiles("staging").run { context ->
            assertThat(context).hasFailed()
            assertEquals("fake adapter ephemeral-jwt-keys is not allowed in profiles [staging]", rootMessage(context))
        }
    }

    @Test
    fun `a local or test profile mixed with a production profile does not allow ephemeral keys`() {
        runner.profiles("prod", "local").run { context ->
            assertThat(context).hasFailed()
            assertEquals("fake adapter ephemeral-jwt-keys is not allowed in profiles [prod, local]", rootMessage(context))
        }
        runner.profiles("staging", "test").run { context ->
            assertThat(context).hasFailed()
            assertEquals("fake adapter ephemeral-jwt-keys is not allowed in profiles [staging, test]", rootMessage(context))
        }
    }

    @Test
    fun `empty keys in profile test use an ephemeral pair`() {
        runner.profiles("test").run { context ->
            val codec = context.getBean(JwtCodec::class.java)
            val user = UUID.randomUUID()
            assertEquals(user, codec.verify(codec.issue(user, UUID.randomUUID(), Instant.now())).userId)
        }
    }

    @Test
    fun `configured pem keys are used in any profile`() {
        val pair = JwtTest.newKeyPair()
        runner
            .profiles("staging")
            .withPropertyValues(
                "cetele.jwt.private-key-pem=" + pem("PRIVATE KEY", pair.private.encoded).replace("\n", "\\n"),
                "cetele.jwt.public-key-pem=" + pem("PUBLIC KEY", pair.public.encoded),
            ).run { context ->
                val codec = assertNotNull(context.getBean(JwtCodec::class.java))
                val token = codec.issue(UUID.randomUUID(), UUID.randomUUID(), Instant.now())
                assertNotNull(codec(pair).verify(token))
            }
    }

    @Test
    fun `mismatched or half configured keys stop the context`() {
        val pair = JwtTest.newKeyPair()
        val other = JwtTest.newKeyPair()
        runner
            .withPropertyValues(
                "cetele.jwt.private-key-pem=" + pem("PRIVATE KEY", pair.private.encoded),
                "cetele.jwt.public-key-pem=" + pem("PUBLIC KEY", other.public.encoded),
            ).run { context ->
                assertThat(context).hasFailed()
                assertEquals("JWT private and public keys do not belong together", rootMessage(context))
            }
        runner
            .profiles("test")
            .withPropertyValues("cetele.jwt.public-key-pem=" + pem("PUBLIC KEY", pair.public.encoded))
            .run { context ->
                assertThat(context).hasFailed()
                assertTrue(rootMessage(context).contains("must both be set"))
            }
    }

    private fun codec(pair: KeyPair): JwtCodec =
        JwtCodec(
            pair.private as ECPrivateKey,
            pair.public as ECPublicKey,
            "https://cetele.app",
            Duration.ofMinutes(15),
            Duration.ofSeconds(30),
            Clock.systemUTC(),
        )

    private fun rootMessage(context: AssertableApplicationContext): String {
        var cause: Throwable = assertNotNull(context.startupFailure)
        while (cause.cause != null) cause = cause.cause!!
        return cause.message.orEmpty()
    }

    /** PEM text built at run time from a key created by the test; nothing key-shaped is stored in the source. */
    private fun pem(
        label: String,
        der: ByteArray,
    ): String {
        val dashes = "-----"
        val body = Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(der)
        return "${dashes}BEGIN $label$dashes\n$body\n${dashes}END $label$dashes\n"
    }

    private fun ApplicationContextRunner.profiles(vararg names: String): ApplicationContextRunner =
        withInitializer { context -> context.environment.setActiveProfiles(*names) }

    @TestConfiguration(proxyBeanMethods = false)
    @EnableConfigurationProperties(JwtProperties::class)
    class JwtTestConfiguration
}
