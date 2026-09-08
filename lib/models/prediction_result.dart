import 'course_profile.dart';
import 'course_segment.dart';
import 'rider_profile.dart';

/// 1区間の予測結果。
class SegmentPrediction {
  final CourseSegment segment;
  final double targetPowerWatts;
  final double speedKmh;
  final Duration time;

  const SegmentPrediction({
    required this.segment,
    required this.targetPowerWatts,
    required this.speedKmh,
    required this.time,
  });
}

/// コース全体の予測結果。
class ClimbPrediction {
  final CourseProfile course;
  final RiderProfile rider;
  final List<SegmentPrediction> segments;

  const ClimbPrediction({
    required this.course,
    required this.rider,
    required this.segments,
  });

  Duration get totalTime => segments.fold(
        Duration.zero,
        (sum, s) => sum + s.time,
      );

  double get averagePowerWatts {
    final totalSeconds = totalTime.inSeconds;
    if (totalSeconds == 0) return 0;
    final weightedSum = segments.fold<double>(
      0,
      (sum, s) => sum + s.targetPowerWatts * s.time.inSeconds,
    );
    return weightedSum / totalSeconds;
  }
}
