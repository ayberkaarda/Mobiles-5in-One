package app.cetele.android.startup

import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch

/** Foreground and background moves of the whole process, applied in the order they happened. */
interface AppVisibility {
    suspend fun onForeground()

    suspend fun onBackground()
}

/**
 * Process lifecycle hook: start and stop are queued so a quick background and return never apply out of order.
 */
class LockLifecycleObserver(
    private val visibility: AppVisibility,
    scope: CoroutineScope,
) : DefaultLifecycleObserver {
    private val moves = Channel<Boolean>(Channel.UNLIMITED)

    init {
        scope.launch {
            for (foreground in moves) {
                if (foreground) visibility.onForeground() else visibility.onBackground()
            }
        }
    }

    override fun onStart(owner: LifecycleOwner) {
        moves.trySend(true)
    }

    override fun onStop(owner: LifecycleOwner) {
        moves.trySend(false)
    }
}
