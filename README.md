# norikura-time

体重(Health アプリ)・FTP(intervals.icu)・コースプロフィール(乗鞍エコーライン)から
乗鞍ヒルクライムの完走タイムを予測する Flutter アプリ。

設計の詳細は [DESIGN.md](./DESIGN.md) を参照。

## 構成

```
lib/
  models/     # CourseProfile, CourseSegment, RiderProfile, ClimbPrediction 等
  services/
    course_repository.dart         # ①コースプロフィール取得 (バンドルJSON)
    health_service.dart            # ②体重取得 (HealthKit / Health Connect)
    intervals_icu_service.dart     # ③FTP取得 (intervals.icu REST API)
    settings_repository.dart       # APIキー等をセキュアストレージに保存
    climb_prediction_service.dart  # 物理モデルによるタイム予測エンジン
  screens/
    home_screen.dart      # 予測実行・結果表示
    settings_screen.dart  # intervals.icu認証情報・自転車重量の設定
assets/courses/norikura_echo_line.json  # 乗鞍エコーラインの区間プロフィール
test/climb_prediction_service_test.dart # 予測エンジンの単体テスト
```

## セットアップ (このリポジトリにはFlutter SDKが含まれていません)

1. [Flutter SDK](https://docs.flutter.dev/get-started/install) をインストール
2. 依存取得: `flutter pub get`
3. ネイティブプロジェクトを生成 (android/ios フォルダがまだ無いため):
   `flutter create --platforms=ios,android .`
4. iOS: `ios/Runner/Info.plist` に以下を追加し、Xcodeで HealthKit Capability を有効化
   ```xml
   <key>NSHealthShareUsageDescription</key>
   <string>体重データをもとにヒルクライムタイムを予測するために使用します</string>
   ```
5. Android: Health Connect アプリの導入が必要。`android/app/src/main/AndroidManifest.xml` に
   health permission (`android.permission.health.READ_WEIGHT` 等) を追加
6. intervals.icu の Settings > Developer Settings で API キーを発行し、アプリの設定画面に入力
7. 実行: `flutter run`
8. テスト: `flutter test`

## 既知の制約

- `assets/courses/norikura_echo_line.json` の区間勾配は公式大会要項の概算値。
  実測GPX(Strava/RideWithGPSなど)に差し替えると予測精度が上がる。
- 本セッションの開発環境に Flutter SDK が無いため、`flutter pub get` / ビルド確認は未実施。
  ローカル環境でのビルド確認を推奨。
