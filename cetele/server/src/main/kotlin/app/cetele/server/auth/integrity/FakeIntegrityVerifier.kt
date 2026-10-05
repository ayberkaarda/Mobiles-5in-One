package app.cetele.server.auth.integrity

/**
 * Stand-in verifier for the local and test profiles (refused anywhere else by
 * `LocalOnlyAdapterGuard`). It understands exactly four tokens; anything else is invalid:
 *
 * - `fake.ok`: a genuine app on a genuine device, bound to the request;
 * - `fake.unrecognized-app`: an app version Play does not recognise (re-signed or sideloaded);
 * - `fake.no-device-integrity`: a device without `MEETS_DEVICE_INTEGRITY` (emulator, rooted);
 * - `fake.package-mismatch`: a token issued for another package.
 */
class FakeIntegrityVerifier(
    private val packageName: String,
) : IntegrityVerifier {
    override fun decode(
        token: String,
        expectedNonce: String,
    ): IntegrityVerdict? {
        val genuine =
            IntegrityVerdict(
                packageName = packageName,
                appRecognition = AppRecognition.PLAY_RECOGNIZED,
                deviceRecognition = setOf(IntegrityPolicy.MEETS_DEVICE_INTEGRITY),
                requestHash = expectedNonce,
            )
        return when (token) {
            OK -> genuine
            UNRECOGNIZED_APP -> genuine.copy(appRecognition = AppRecognition.UNRECOGNIZED_VERSION)
            NO_DEVICE_INTEGRITY -> genuine.copy(deviceRecognition = emptySet())
            PACKAGE_MISMATCH -> genuine.copy(packageName = "$packageName.repackaged")
            else -> null
        }
    }

    companion object {
        const val ADAPTER_NAME = "fake-integrity-verifier"
        const val OK = "fake.ok"
        const val UNRECOGNIZED_APP = "fake.unrecognized-app"
        const val NO_DEVICE_INTEGRITY = "fake.no-device-integrity"
        const val PACKAGE_MISMATCH = "fake.package-mismatch"
    }
}
