import 'dart:convert';

import 'package:http/http.dart' as http;

/// intervals.icuからFTPを取得する例外。
class IntervalsIcuException implements Exception {
  final String message;
  IntervalsIcuException(this.message);

  @override
  String toString() => 'IntervalsIcuException: $message';
}

/// FTPの取得(③)。intervals.icu REST APIをHTTP Basic認証(username固定
/// "API_KEY", passwordに発行済みAPIキー)で呼び出す。
///
/// 参照: https://intervals.icu/features/open-api/
class IntervalsIcuService {
  static const _baseUrl = 'https://intervals.icu/api/v1';

  final String athleteId;
  final String apiKey;
  final http.Client _client;

  IntervalsIcuService({
    required this.athleteId,
    required this.apiKey,
    http.Client? client,
  }) : _client = client ?? http.Client();

  Map<String, String> get _headers {
    final token = base64Encode(utf8.encode('API_KEY:$apiKey'));
    return {'Authorization': 'Basic $token'};
  }

  /// 現在のFTP(W)を取得する。intervals.icuが算出する `icu_ftp` を使用する。
  /// 特定種目(Rideなど)に手動設定されたFTPを使いたい場合は
  /// `/athlete/{id}/sport-settings/{type}` の `ftp` フィールドを参照すること。
  Future<int> fetchCurrentFtp() async {
    final uri = Uri.parse('$_baseUrl/athlete/$athleteId');
    final response = await _client.get(uri, headers: _headers);

    if (response.statusCode != 200) {
      throw IntervalsIcuException(
        'intervals.icu API error: ${response.statusCode} ${response.body}',
      );
    }

    final json = jsonDecode(response.body) as Map<String, dynamic>;
    final ftp = json['icu_ftp'];
    if (ftp == null) {
      throw IntervalsIcuException('icu_ftp field not found in response');
    }
    return (ftp as num).round();
  }

  void dispose() => _client.close();
}
