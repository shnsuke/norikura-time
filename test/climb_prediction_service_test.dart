import 'package:flutter_test/flutter_test.dart';
import 'package:norikura_time/models/course_profile.dart';
import 'package:norikura_time/models/course_segment.dart';
import 'package:norikura_time/models/rider_profile.dart';
import 'package:norikura_time/services/climb_prediction_service.dart';

void main() {
  final course = CourseProfile(
    id: 'test',
    name: 'テストコース',
    source: 'unit test',
    segments: const [
      CourseSegment(
        name: '区間1',
        startDistanceKm: 0,
        endDistanceKm: 8.7,
        startElevationM: 1460,
        endElevationM: 1870,
      ),
      CourseSegment(
        name: '区間2',
        startDistanceKm: 8.7,
        endDistanceKm: 17.0,
        startElevationM: 1870,
        endElevationM: 2350,
      ),
      CourseSegment(
        name: '区間3',
        startDistanceKm: 17.0,
        endDistanceKm: 20.5,
        startElevationM: 2350,
        endElevationM: 2720,
      ),
    ],
  );

  final service = ClimbPredictionService();

  test('コース全体の距離・標高差が公式値と一致する', () {
    expect(course.totalDistanceKm, closeTo(20.5, 0.01));
    expect(course.totalElevationGainM, closeTo(1260, 0.01));
  });

  test('FTPが高いライダーほど予測タイムが短い', () {
    final strongRider = RiderProfile(weightKg: 60, ftpWatts: 300);
    final weakRider = RiderProfile(weightKg: 60, ftpWatts: 200);

    final strongPrediction = service.predict(course, strongRider);
    final weakPrediction = service.predict(course, weakRider);

    expect(
      strongPrediction.totalTime.inSeconds,
      lessThan(weakPrediction.totalTime.inSeconds),
    );
  });

  test('体重が重いほど同じFTPでは予測タイムが長い(W/kgが下がるため)', () {
    final lightRider = RiderProfile(weightKg: 55, ftpWatts: 250);
    final heavyRider = RiderProfile(weightKg: 75, ftpWatts: 250);

    final lightPrediction = service.predict(course, lightRider);
    final heavyPrediction = service.predict(course, heavyRider);

    expect(
      lightPrediction.totalTime.inSeconds,
      lessThan(heavyPrediction.totalTime.inSeconds),
    );
  });

  test('妥当な範囲のタイムが算出される (3W/kg級で概ね70〜140分)', () {
    final rider = RiderProfile(weightKg: 65, ftpWatts: 195); // 3.0 W/kg
    final prediction = service.predict(course, rider);
    final minutes = prediction.totalTime.inMinutes;

    expect(minutes, greaterThan(60));
    expect(minutes, lessThan(160));
  });
}
