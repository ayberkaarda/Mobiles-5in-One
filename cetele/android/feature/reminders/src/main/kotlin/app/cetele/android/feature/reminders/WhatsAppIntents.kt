package app.cetele.android.feature.reminders

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent

object WhatsAppIntents {
    fun send(
        context: Context,
        text: String,
    ) {
        val share =
            Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, text)
            }
        try {
            context.startActivity(share.copyFor(context).setPackage("com.whatsapp"))
        } catch (_: ActivityNotFoundException) {
            context.startActivity(Intent.createChooser(share, null).copyFor(context))
        }
    }

    private fun Intent.copyFor(context: Context): Intent =
        Intent(this).apply {
            if (context !is Activity) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
}
