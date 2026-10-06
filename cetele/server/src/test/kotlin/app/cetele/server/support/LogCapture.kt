package app.cetele.server.support

import org.junit.jupiter.api.extension.ExtendWith
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.boot.test.system.OutputCaptureExtension
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Captures console output (the application log) of a test. Annotate the test class with
 * [LogCapture] and take a [CapturedOutput] parameter:
 *
 * ```
 * @LogCapture
 * class AuthLogSampleTest {
 *     @Test fun flow(output: CapturedOutput) { ...; output.assertNoneOf(phone, code, token) }
 * }
 * ```
 */
@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
@ExtendWith(OutputCaptureExtension::class)
annotation class LogCapture

/** Fails when any of [secrets] appears in the captured output. */
fun CapturedOutput.assertNoneOf(vararg secrets: String) {
    val text = all
    secrets.filter { it.isNotEmpty() }.forEach { secret ->
        assertFalse(text.contains(secret), "captured log output contains a value that must be masked")
    }
}

fun CapturedOutput.assertContains(expected: String) {
    assertTrue(all.contains(expected), "captured log output does not contain the expected text")
}
