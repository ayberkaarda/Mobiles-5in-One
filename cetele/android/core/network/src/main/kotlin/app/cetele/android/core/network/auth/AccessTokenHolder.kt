package app.cetele.android.core.network.auth

import java.util.concurrent.atomic.AtomicReference
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AccessTokenHolder
    @Inject
    constructor() {
        internal data class Snapshot(
            val token: String?,
            val revision: Long,
        )

        private val token = AtomicReference(Snapshot(null, 0))
        var accessToken: String?
            get() = token.get().token
            set(value) {
                token.updateAndGet { Snapshot(value, it.revision + 1) }
            }

        fun clear() {
            accessToken = null
        }

        internal fun snapshot(): Snapshot = token.get()

        internal fun replace(
            snapshot: Snapshot,
            value: String?,
        ): Boolean = token.compareAndSet(snapshot, Snapshot(value, snapshot.revision + 1))
    }
