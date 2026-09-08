import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// intervals.icuの認証情報や物理パラメータ設定を端末のセキュアストレージに保存する。
class SettingsRepository {
  static const _athleteIdKey = 'intervals_icu_athlete_id';
  static const _apiKeyKey = 'intervals_icu_api_key';
  static const _bikeWeightKey = 'bike_weight_kg';

  final FlutterSecureStorage _storage;

  SettingsRepository({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  Future<void> saveIntervalsIcuCredentials({
    required String athleteId,
    required String apiKey,
  }) async {
    await _storage.write(key: _athleteIdKey, value: athleteId);
    await _storage.write(key: _apiKeyKey, value: apiKey);
  }

  Future<({String athleteId, String apiKey})?> loadIntervalsIcuCredentials() async {
    final athleteId = await _storage.read(key: _athleteIdKey);
    final apiKey = await _storage.read(key: _apiKeyKey);
    if (athleteId == null || apiKey == null) return null;
    return (athleteId: athleteId, apiKey: apiKey);
  }

  Future<void> saveBikeWeightKg(double weightKg) async {
    await _storage.write(key: _bikeWeightKey, value: weightKg.toString());
  }

  Future<double?> loadBikeWeightKg() async {
    final raw = await _storage.read(key: _bikeWeightKey);
    if (raw == null) return null;
    return double.tryParse(raw);
  }
}
