package app.cetele.android

import android.os.Build
import android.os.Bundle
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import androidx.fragment.app.FragmentActivity
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.cetele.android.core.data.lock.LockController
import app.cetele.android.core.data.lock.LockState
import app.cetele.android.core.data.settings.ThemeMode
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.designsystem.SecureWindowPolicy
import app.cetele.android.navigation.CeteleNavHost
import app.cetele.android.navigation.startRoute
import app.cetele.android.shell.ShellScreen
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/** A [FragmentActivity] so the lock screen can show the biometric prompt. */
@AndroidEntryPoint
class MainActivity : FragmentActivity() {
    @Inject lateinit var lock: LockController

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            val lockState by lock.state.collectAsStateWithLifecycle()
            LaunchedEffect(lockState) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    val policy = SecureWindowPolicy(lockState != LockState.NoPin, Build.VERSION.SDK_INT)
                    setRecentsScreenshotEnabled(policy.recentsScreenshotsEnabled)
                }
            }
            CeteleApp()
        }
    }
}

@Composable
private fun CeteleApp(model: AppViewModel = hiltViewModel()) {
    val theme by model.themeMode.collectAsStateWithLifecycle()
    val gate by model.gate.collectAsStateWithLifecycle()
    val dark = theme.isDark(isSystemInDarkTheme())
    SystemBarsAppearance(dark)
    CeteleTheme(darkTheme = dark) {
        val current = gate
        if (current == null) {
            ShellScreen()
        } else {
            val start = remember { current.startRoute() }
            CeteleNavHost(model.services, current, start)
        }
    }
}

/** Status and navigation bar icons follow the app theme, which can differ from the system one. */
@Composable
private fun SystemBarsAppearance(dark: Boolean) {
    val window = LocalActivity.current?.window ?: return
    val view = LocalView.current
    SideEffect {
        WindowCompat.getInsetsController(window, view).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }
}

fun ThemeMode.isDark(systemDark: Boolean): Boolean =
    when (this) {
        ThemeMode.SYSTEM -> systemDark
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
    }
