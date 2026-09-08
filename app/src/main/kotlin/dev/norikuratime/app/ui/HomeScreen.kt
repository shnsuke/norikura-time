package dev.norikuratime.app.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
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
import androidx.activity.compose.rememberLauncherForActivityResult
import dev.norikuratime.app.data.CourseAssetLoader
import dev.norikuratime.app.data.HealthConnectRepository
import dev.norikuratime.app.data.SettingsRepository
import dev.norikuratime.core.ClimbPrediction
import dev.norikuratime.core.ClimbPredictionService
import dev.norikuratime.core.IntervalsIcuClient
import dev.norikuratime.core.RiderProfile
import kotlinx.coroutines.launch

@Composable
fun HomeScreen(onOpenSettings: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val healthConnectRepository = remember { HealthConnectRepository(context) }
    val courseAssetLoader = remember { CourseAssetLoader(context) }
    val settingsRepository = remember { SettingsRepository(context) }
    val predictionService = remember { ClimbPredictionService() }

    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var prediction by remember { mutableStateOf<ClimbPrediction?>(null) }
    var pendingRun by remember { mutableStateOf(false) }

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = healthConnectRepository.permissionRequestContract,
    ) { granted ->
        if (granted.containsAll(healthConnectRepository.requiredPermissions)) {
            pendingRun = true
        } else {
            error = "Health Connect の体重読み取り権限が許可されませんでした"
            loading = false
        }
    }

    suspend fun runPrediction() {
        loading = true
        error = null
        try {
            val credentials = settingsRepository.loadIntervalsIcuCredentials()
                ?: throw IllegalStateException("先に設定画面でintervals.icuのAthlete ID/APIキーを登録してください")

            if (!healthConnectRepository.isAvailable()) {
                throw IllegalStateException("この端末にHealth Connectがインストールされていません")
            }
            if (!healthConnectRepository.hasAllPermissions()) {
                loading = false
                permissionLauncher.launch(healthConnectRepository.requiredPermissions)
                return
            }

            val weightKg = healthConnectRepository.fetchLatestWeightKg()
                ?: throw IllegalStateException("Health Connectから体重データが取得できませんでした")

            val ftpWatts = IntervalsIcuClient().fetchCurrentFtp(
                athleteId = credentials.athleteId,
                apiKey = credentials.apiKey,
            )

            val course = courseAssetLoader.loadNorikuraEcholine()
            val bikeWeightKg = settingsRepository.loadBikeWeightKg() ?: 8.0

            val rider = RiderProfile(
                weightKg = weightKg,
                bikeWeightKg = bikeWeightKg,
                ftpWatts = ftpWatts,
            )

            prediction = predictionService.predict(course, rider)
        } catch (e: Exception) {
            error = e.message ?: e.toString()
        } finally {
            loading = false
        }
    }

    LaunchedEffect(pendingRun) {
        if (pendingRun) {
            pendingRun = false
            loading = true
            runPrediction()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("乗鞍ヒルクライム タイム予測") },
                actions = {
                    IconButton(onClick = onOpenSettings) {
                        Icon(Icons.Filled.Settings, contentDescription = "設定")
                    }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
            Button(
                onClick = { scope.launch { runPrediction() } },
                enabled = !loading,
            ) {
                Text(if (loading) "取得・計算中..." else "体重・FTP・コースを取得して予測")
            }

            if (loading) {
                CircularProgressIndicator(modifier = Modifier.padding(top = 16.dp))
            }

            error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 16.dp))
            }

            prediction?.let { result ->
                Card(modifier = Modifier.padding(top = 16.dp)) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        val total = result.totalTime
                        val hours = total.inWholeHours
                        val minutes = total.inWholeMinutes % 60
                        val seconds = total.inWholeSeconds % 60
                        val timeText = if (hours > 0) {
                            "${hours}時間${minutes}分${seconds}秒"
                        } else {
                            "${minutes}分${seconds}秒"
                        }
                        Text("予測合計タイム: $timeText", style = MaterialTheme.typography.titleLarge)
                        Text(
                            "体重 ${"%.1f".format(result.rider.weightKg)}kg / " +
                                "FTP ${result.rider.ftpWatts}W / " +
                                "${"%.2f".format(result.rider.wattsPerKg)} W/kg",
                        )
                        Text("平均出力目安: ${"%.0f".format(result.averagePowerWatts)}W")
                    }
                }

                LazyColumn(modifier = Modifier.padding(top = 8.dp)) {
                    items(result.segments) { segment ->
                        val t = segment.time
                        val m = t.inWholeMinutes
                        val s = t.inWholeSeconds % 60
                        ListItem(
                            headlineContent = { Text(segment.segment.name) },
                            supportingContent = {
                                Text(
                                    "${"%.1f".format(segment.segment.distanceKm)}km / " +
                                        "平均勾配${"%.1f".format(segment.segment.averageGradient * 100)}% / " +
                                        "目標${"%.0f".format(segment.targetPowerWatts)}W",
                                )
                            },
                            trailingContent = { Text("${m}分${s}秒") },
                        )
                    }
                }
            }
        }
    }
}
