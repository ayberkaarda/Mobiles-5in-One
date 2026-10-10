package app.cetele.android.core.data.session

import android.content.Context
import androidx.work.WorkManager
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject

class WorkSession
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
    ) : SessionWork {
        override suspend fun cancelAll() {
            withContext(Dispatchers.IO) {
                WorkManager
                    .getInstance(context)
                    .cancelAllWork()
                    .result
                    .get()
            }
        }
    }
