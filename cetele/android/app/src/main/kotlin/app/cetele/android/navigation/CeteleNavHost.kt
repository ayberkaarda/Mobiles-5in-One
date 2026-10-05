package app.cetele.android.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import app.cetele.android.shell.ShellScreen

@Composable
fun CeteleNavHost() {
    val navController = rememberNavController()
    NavHost(navController = navController, startDestination = ShellRoute) {
        composable<ShellRoute> { ShellScreen() }
    }
}
