package app.cetele.android.core.designsystem

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class SecureWindowPolicyTest {
    @Test fun recentsAreDisabledOnlyWithPinOnSupportedVersions() {
        for (sdk in listOf(26, 32, 33, 36)) {
            for (pinSet in listOf(false, true)) {
                val policy = SecureWindowPolicy(pinSet, sdk)
                assertEquals(!pinSet || sdk < 33, policy.recentsScreenshotsEnabled)
            }
        }
    }
}
