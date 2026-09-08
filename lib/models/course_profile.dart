import 'course_segment.dart';

/// コース全体のプロファイル(複数区間の集合)。
class CourseProfile {
  final String id;
  final String name;
  final String source;
  final List<CourseSegment> segments;

  const CourseProfile({
    required this.id,
    required this.name,
    required this.source,
    required this.segments,
  });

  factory CourseProfile.fromJson(Map<String, dynamic> json) {
    return CourseProfile(
      id: json['id'] as String,
      name: json['name'] as String,
      source: json['source'] as String? ?? '',
      segments: (json['segments'] as List)
          .map((e) => CourseSegment.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  double get totalDistanceKm =>
      segments.fold(0.0, (sum, s) => sum + s.distanceKm);

  double get totalElevationGainM =>
      segments.fold(0.0, (sum, s) => sum + s.elevationGainM);

  double get averageGradient =>
      totalDistanceKm == 0 ? 0 : totalElevationGainM / (totalDistanceKm * 1000);
}
