package dev.norikuratime.app.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import dev.norikuratime.app.data.IntervalsIcuCredentials
import dev.norikuratime.app.data.SettingsRepository
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val settingsRepository = remember { SettingsRepository(context) }

    var athleteId by remember { mutableStateOf("") }
    var apiKey by remember { mutableStateOf("") }
    var bikeWeight by remember { mutableStateOf("8.0") }
    var saving by remember { mutableStateOf(false) }
    var savedMessage by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        settingsRepository.loadIntervalsIcuCredentials()?.let {
            athleteId = it.athleteId
            apiKey = it.apiKey
        }
        settingsRepository.loadBikeWeightKg()?.let {
            bikeWeight = it.toString()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("設定") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Filled.ArrowBack, contentDescription = "戻る")
                    }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
            Text("intervals.icu (Settings > Developer Settings でAPIキーを発行)")
            TextField(
                value = athleteId,
                onValueChange = { athleteId = it },
                label = { Text("Athlete ID (例: i123456)") },
                modifier = Modifier.padding(top = 8.dp),
            )
            TextField(
                value = apiKey,
                onValueChange = { apiKey = it },
                label = { Text("API Key") },
                modifier = Modifier.padding(top = 8.dp),
            )
            Text("自転車・装備重量", modifier = Modifier.padding(top = 24.dp))
            TextField(
                value = bikeWeight,
                onValueChange = { bikeWeight = it },
                label = { Text("重量 (kg)") },
                modifier = Modifier.padding(top = 8.dp),
            )
            Button(
                onClick = {
                    saving = true
                    scope.launch {
                        settingsRepository.saveIntervalsIcuCredentials(
                            IntervalsIcuCredentials(athleteId.trim(), apiKey.trim()),
                        )
                        bikeWeight.trim().toDoubleOrNull()?.let {
                            settingsRepository.saveBikeWeightKg(it)
                        }
                        saving = false
                        savedMessage = "設定を保存しました"
                    }
                },
                enabled = !saving,
                modifier = Modifier.padding(top = 24.dp),
            ) {
                Text(if (saving) "保存中..." else "保存")
            }
            savedMessage?.let {
                Text(it, modifier = Modifier.padding(top = 8.dp))
            }
        }
    }
}
