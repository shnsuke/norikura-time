import 'package:flutter/material.dart';

import '../models/prediction_result.dart';
import '../models/rider_profile.dart';
import '../services/climb_prediction_service.dart';
import '../services/course_repository.dart';
import '../services/health_service.dart';
import '../services/intervals_icu_service.dart';
import '../services/settings_repository.dart';
import 'settings_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _healthService = HealthService();
  final _courseRepository = CourseRepository();
  final _settingsRepository = SettingsRepository();
  final _predictionService = ClimbPredictionService();

  bool _loading = false;
  String? _error;
  ClimbPrediction? _prediction;

  Future<void> _runPrediction() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final credentials =
          await _settingsRepository.loadIntervalsIcuCredentials();
      if (credentials == null) {
        throw Exception('先に設定画面でintervals.icuのAthlete ID/APIキーを登録してください');
      }

      await _healthService.configure();
      final authorized = await _healthService.requestPermissions();
      if (!authorized) {
        throw Exception('Healthデータへのアクセスが許可されませんでした');
      }

      final results = await Future.wait([
        _healthService.fetchLatestWeightKg(),
        IntervalsIcuService(
          athleteId: credentials.athleteId,
          apiKey: credentials.apiKey,
        ).fetchCurrentFtp(),
        _courseRepository.loadNorikuraEcholine(),
        _settingsRepository.loadBikeWeightKg(),
      ]);

      final weightKg = results[0] as double?;
      final ftpWatts = results[1] as int;
      final course = results[2];
      final bikeWeightKg = results[3] as double?;

      if (weightKg == null) {
        throw Exception('Healthアプリから体重データが取得できませんでした(手動入力は今後対応予定)');
      }

      final rider = RiderProfile(
        weightKg: weightKg,
        bikeWeightKg: bikeWeightKg ?? 8.0,
        ftpWatts: ftpWatts,
      );

      final prediction = _predictionService.predict(course, rider);

      setState(() {
        _prediction = prediction;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  String _formatDuration(Duration d) {
    final h = d.inHours;
    final m = d.inMinutes.remainder(60);
    final s = d.inSeconds.remainder(60);
    if (h > 0) {
      return '$h時間$m分$s秒';
    }
    return '$m分$s秒';
  }

  @override
  Widget build(BuildContext context) {
    final prediction = _prediction;
    return Scaffold(
      appBar: AppBar(
        title: const Text('乗鞍ヒルクライム タイム予測'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const SettingsScreen()),
            ),
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            FilledButton(
              onPressed: _loading ? null : _runPrediction,
              child: Text(_loading ? '取得・計算中...' : '体重・FTP・コースを取得して予測'),
            ),
            const SizedBox(height: 16),
            if (_error != null)
              Text(_error!, style: const TextStyle(color: Colors.red)),
            if (prediction != null) ...[
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '予測合計タイム: ${_formatDuration(prediction.totalTime)}',
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      Text(
                        '体重 ${prediction.rider.weightKg.toStringAsFixed(1)}kg / '
                        'FTP ${prediction.rider.ftpWatts}W / '
                        '${prediction.rider.wattsPerKg.toStringAsFixed(2)} W/kg',
                      ),
                      Text(
                        '平均出力目安: ${prediction.averagePowerWatts.toStringAsFixed(0)}W',
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Expanded(
                child: ListView.builder(
                  itemCount: prediction.segments.length,
                  itemBuilder: (context, index) {
                    final s = prediction.segments[index];
                    return ListTile(
                      title: Text(s.segment.name),
                      subtitle: Text(
                        '${s.segment.distanceKm.toStringAsFixed(1)}km / '
                        '平均勾配${(s.segment.averageGradient * 100).toStringAsFixed(1)}% / '
                        '目標${s.targetPowerWatts.toStringAsFixed(0)}W',
                      ),
                      trailing: Text(_formatDuration(s.time)),
                    );
                  },
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
