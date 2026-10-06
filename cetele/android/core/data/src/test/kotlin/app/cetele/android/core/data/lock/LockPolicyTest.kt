package app.cetele.android.core.data.lock

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class LockPolicyTest {
    @Test fun coldStartAlwaysLocks() {
        assertTrue(LockPolicy.shouldLock(null, 0, 120, true))
    }

    @Test fun exactBoundary() {
        assertFalse(LockPolicy.shouldLock(1000, 120000, 120, false))
        assertTrue(LockPolicy.shouldLock(1000, 121000, 120, false))
        assertFalse(LockPolicy.shouldLock(1000, 121000, 300, false))
        assertTrue(LockPolicy.shouldLock(1000, 61000, 60, false))
        assertFalse(LockPolicy.shouldLock(null, 200000, 120, false))
    }
}
