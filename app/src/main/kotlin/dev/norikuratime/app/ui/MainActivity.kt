package dev.norikuratime.app.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            NorikuraTimeApp()
        }
    }
}

private enum class Screen { Home, Settings }

@Composable
private fun NorikuraTimeApp() {
    var screen by remember { mutableStateOf(Screen.Home) }

    MaterialTheme {
        Surface(modifier = Modifier) {
            when (screen) {
                Screen.Home -> HomeScreen(onOpenSettings = { screen = Screen.Settings })
                Screen.Settings -> SettingsScreen(onBack = { screen = Screen.Home })
            }
        }
    }
}
