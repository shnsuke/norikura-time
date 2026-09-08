import 'package:health/health.dart';

/// 体重の取得(②)。iOSはHealthKit、AndroidはHealth Connectを
/// `health` パッケージ経由で吸収する。
///
/// 注意: `health` パッケージはバージョンによってAPIが変わることがあるため、
/// `flutter pub get` 後に実際のバージョンのAPIと突き合わせて確認すること
/// (このリポジトリの開発環境にはFlutter SDKが無く、コンパイル確認は未実施)。
class HealthService {
  final Health _health = Health();

  static const _types = [HealthDataType.WEIGHT];
  static const _permissions = [HealthDataAccess.READ];

  Future<void> configure() => _health.configure();

  Future<bool> requestPermissions() async {
    final hasPermissions =
        await _health.hasPermissions(_types, permissions: _permissions);
    if (hasPermissions == true) return true;
    return _health.requestAuthorization(_types, permissions: _permissions);
  }

  /// 直近90日以内で最新の体重(kg)を返す。データが無い場合はnull。
  Future<double?> fetchLatestWeightKg({int lookbackDays = 90}) async {
    final now = DateTime.now();
    final start = now.subtract(Duration(days: lookbackDays));

    final data = await _health.getHealthDataFromTypes(
      types: _types,
      startTime: start,
      endTime: now,
    );
    if (data.isEmpty) return null;

    data.sort((a, b) => b.dateTo.compareTo(a.dateTo));
    final latest = data.first;
    return _toKilograms(latest);
  }

  double? _toKilograms(HealthDataPoint point) {
    final value = point.value;
    if (value is! NumericHealthValue) return null;
    final numeric = value.numericValue.toDouble();

    switch (point.unit) {
      case HealthDataUnit.KILOGRAM:
        return numeric;
      case HealthDataUnit.GRAM:
        return numeric / 1000;
      case HealthDataUnit.POUND:
        return numeric * 0.45359237;
      default:
        // 未知の単位の場合はkgとみなす(要確認)
        return numeric;
    }
  }
}
