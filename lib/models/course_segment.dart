import 'dart:math' as math;

/// コースの一区間。距離と標高の始点・終点から平均勾配を導出する。
class CourseSegment {
  final String name;
  final double startDistanceKm;
  final double endDistanceKm;
  final double startElevationM;
  final double endElevationM;

  const CourseSegment({
    required this.name,
    required this.startDistanceKm,
    required this.endDistanceKm,
    required this.startElevationM,
    required this.endElevationM,
  });

  factory CourseSegment.fromJson(Map<String, dynamic> json) {
    return CourseSegment(
      name: json['name'] as String,
      startDistanceKm: (json['startDistanceKm'] as num).toDouble(),
      endDistanceKm: (json['endDistanceKm'] as num).toDouble(),
      startElevationM: (json['startElevationM'] as num).toDouble(),
      endElevationM: (json['endElevationM'] as num).toDouble(),
    );
  }

  double get distanceKm => endDistanceKm - startDistanceKm;
  double get distanceM => distanceKm * 1000;
  double get elevationGainM => endElevationM - startElevationM;

  /// 平均勾配 (0.061 = 6.1%)
  double get averageGradient =>
      distanceM == 0 ? 0 : elevationGainM / distanceM;

  /// atan勾配角(ラジアン)。sin/cosは距離を斜面距離ではなく水平距離とみなした近似。
  double get gradientAngleRad => math.atan(averageGradient);

  /// 区間の標高中央値。空気密度計算に使用。
  double get midElevationM => (startElevationM + endElevationM) / 2;
}
