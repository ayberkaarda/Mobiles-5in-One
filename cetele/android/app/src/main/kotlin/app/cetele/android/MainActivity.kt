package app.cetele.android

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.fragment.app.FragmentActivity
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.cetele.android.core.data.settings.ThemeMode
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.navigation.CeteleNavHost
import app.cetele.android.navigation.startRoute
import app.cetele.android.shell.ShellScreen
import dagger.hilt.android.AndroidEntryPoint

/** A [FragmentActivity] so the lock screen can show the biometric prompt. */
@AndroidEntryPoint
class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent { CeteleApp() }
    }
}

@Composable
private fun CeteleApp(model: AppViewModel = hiltViewModel()) {
    val theme by model.themeMode.collectAsStateWithLifecycle()
    val gate by model.gate.collectAsStateWithLifecycle()
    CeteleTheme(darkTheme = theme.isDark(isSystemInDarkTheme())) {
        val current = gate
        if (current == null) {
            ShellScreen()
        } else {
            val start = remember { current.startRoute() }
            CeteleNavHost(model.services, current, start)
        }
    }
}

fun ThemeMode.isDark(systemDark: Boolean): Boolean =
    when (this) {
        ThemeMode.SYSTEM -> systemDark
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
    }
