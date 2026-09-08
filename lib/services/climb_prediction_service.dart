import 'dart:math' as math;

import '../models/course_profile.dart';
import '../models/course_segment.dart';
import '../models/prediction_result.dart';
import '../models/rider_profile.dart';

/// 物理モデルに基づき、区間ごとの目標パワーから速度・タイムを算出し合算する。
/// Flutter非依存の純Dartロジック(単体テスト可能)。
class ClimbPredictionService {
  static const double gravity = 9.81; // m/s^2
  static const double seaLevelAirDensity = 1.225; // kg/m^3
  static const double scaleHeightM = 8500; // 気圧の高度減衰スケール

  /// 推定所要時間に応じたFTPに対する目標強度(%)。
  static double _targetIntensity(Duration estimatedDuration) {
    final minutes = estimatedDuration.inSeconds / 60;
    if (minutes <= 45) return 1.00;
    if (minutes <= 60) return 0.95;
    if (minutes <= 90) return 0.90;
    if (minutes <= 120) return 0.85;
    return 0.80;
  }

  /// 標高hにおける空気密度の概算(バロメトリック近似)。
  static double airDensityAt(double elevationM) {
    return seaLevelAirDensity * math.exp(-elevationM / scaleHeightM);
  }

  /// 与えられたパワー・勾配・質量・標高から定常走行速度(m/s)をNewton法で解く。
  /// P = [m*g*sin(θ)*v + m*g*Crr*cos(θ)*v + 0.5*ρ*CdA*v^3] / η
  static double _solveSpeedMs({
    required double powerWatts,
    required CourseSegment segment,
    required RiderProfile rider,
  }) {
    if (powerWatts <= 0) return 0;

    final theta = segment.gradientAngleRad;
    final rho = airDensityAt(segment.midElevationM);
    final m = rider.totalMassKg;

    final linearCoeff =
        m * gravity * (math.sin(theta) + rider.crr * math.cos(theta));
    final cubicCoeff = 0.5 * rho * rider.cda;
    final eta = rider.drivetrainEfficiency;

    // f(v) = (linearCoeff*v + cubicCoeff*v^3) / eta - powerWatts = 0
    double v = 5.0; // 初期値 (m/s)
    for (var i = 0; i < 50; i++) {
      final f = (linearCoeff * v + cubicCoeff * math.pow(v, 3)) / eta -
          powerWatts;
      final fPrime = (linearCoeff + 3 * cubicCoeff * v * v) / eta;
      if (fPrime.abs() < 1e-9) break;
      final next = v - f / fPrime;
      if (next <= 0) {
        v = v / 2;
        continue;
      }
      if ((next - v).abs() < 1e-6) {
        v = next;
        break;
      }
      v = next;
    }
    return v;
  }

  /// 与えられたライダー・コースからタイムを予測する。目標強度(%FTP)は
  /// 推定所要時間に応じて収束するまで数回反復する。
  ClimbPrediction predict(CourseProfile course, RiderProfile rider) {
    double intensity = 0.95; // 初期仮定
    List<SegmentPrediction> segmentPredictions = [];

    for (var iteration = 0; iteration < 4; iteration++) {
      final targetPower = rider.ftpWatts * intensity;
      segmentPredictions = course.segments.map((segment) {
        final speedMs = _solveSpeedMs(
          powerWatts: targetPower,
          segment: segment,
          rider: rider,
        );
        final speedKmh = speedMs * 3.6;
        final seconds =
            speedMs <= 0 ? double.infinity : segment.distanceM / speedMs;
        return SegmentPrediction(
          segment: segment,
          targetPowerWatts: targetPower,
          speedKmh: speedKmh,
          time: Duration(seconds: seconds.round()),
        );
      }).toList();

      final totalTime = segmentPredictions.fold<Duration>(
        Duration.zero,
        (sum, s) => sum + s.time,
      );
      final nextIntensity = _targetIntensity(totalTime);
      if ((nextIntensity - intensity).abs() < 0.001) break;
      intensity = nextIntensity;
    }

    return ClimbPrediction(
      course: course,
      rider: rider,
      segments: segmentPredictions,
    );
  }
}
