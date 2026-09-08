import 'dart:convert';

import 'package:flutter/services.dart' show rootBundle;

import '../models/course_profile.dart';

/// コースプロフィールの取得(①)。外部APIが存在しないため、アプリにバンドルした
/// 静的JSONを読み込む。実測GPXへの差し替えはこのJSONを更新するだけでよい。
class CourseRepository {
  static const _norikuraAssetPath = 'assets/courses/norikura_echo_line.json';

  Future<CourseProfile> loadNorikuraEcholine() async {
    final raw = await rootBundle.loadString(_norikuraAssetPath);
    final json = jsonDecode(raw) as Map<String, dynamic>;
    return CourseProfile.fromJson(json);
  }
}
