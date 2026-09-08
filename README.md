# norikura-time

体重(Health Connect)・FTP(intervals.icu)・コースプロフィール(乗鞍エコーライン)から
乗鞍ヒルクライムの完走タイムを予測する **ネイティブAndroidアプリ** (Kotlin + Jetpack Compose)。

設計の詳細は [DESIGN.md](./DESIGN.md) を参照。

> 以前はFlutter(クロスプラットフォーム)案で設計していましたが、開発・検証環境が
> GitHub + Android(iOSなし)であることを踏まえ、ネイティブAndroid構成に切り替えました。
> `:core`(予測エンジン)はこの開発環境でも実際にビルド・テストして動作確認済みです。

## モジュール構成

Gradleマルチモジュール構成。予測エンジンなどAndroidに依存しないロジックを `:core` に
分離することで、Android SDKが無い環境でも予測ロジック単体でビルド・テストできる。

```
core/   # 純Kotlin/JVMモジュール (Androidに依存しない)
  CourseProfile.kt / CourseSegment.kt  # ①コースプロフィール(JSONパース含む)
  RiderProfile.kt                       # ②③体重・FTPを保持するライダー情報
  ClimbPredictionService.kt             # 物理モデルによるタイム予測エンジン
  IntervalsIcuClient.kt                 # ③FTP取得 (intervals.icu REST API, OkHttp)
  src/test/                             # JUnit5単体テスト (このリポジトリで実行・green確認済み)

app/    # Androidアプリケーションモジュール (Jetpack Compose)
  data/HealthConnectRepository.kt  # ②体重取得 (Health Connect)
  data/CourseAssetLoader.kt        # assets内JSONを読み込み core に渡す
  data/SettingsRepository.kt       # intervals.icu認証情報をEncryptedSharedPreferencesに保存
  ui/MainActivity.kt, HomeScreen.kt, SettingsScreen.kt
  src/main/assets/courses/norikura_echo_line.json
```

## この開発環境での検証状況

このサンドボックス環境は Java 21 / Gradle は使えるが、**Android SDKや `dl.google.com`
(Android/Google Maven) への到達がブロック**されているため、以下のように検証範囲が分かれる。

| モジュール | このリポジトリで検証 | 備考 |
|---|---|---|
| `:core` | ✅ `./gradlew :core:test --configure-on-demand` で10件のユニットテストがgreenであることを確認済み | Kotlin/JVMのみ、mavenCentralだけで完結 |
| `:app` | ❌ 未検証(ローカルではAndroid SDK未導入) | GitHub Actions (`.github/workflows/android-ci.yml`) でAndroid SDKを使ってビルド・テストする設計 |

`:core` だけをこの環境相当(Android SDKなし)でビルド・テストしたい場合:

```sh
./gradlew :core:test --configure-on-demand
```

(`--configure-on-demand` を付けないと、Gradleが `:app` も含め全プロジェクトを設定しようとし、
`:app` が使うAndroid Gradle Pluginの解決でgoogle()への到達が必要になり失敗する)

## GitHub Actions CI

`:app` は Android SDK と `dl.google.com` への到達が必要なため、GitHub Actions上
(`android-actions/setup-android`)でビルド・テストを行う設計。push/PRごとに以下を実行:

- `core` ジョブ: `./gradlew :core:test`
- `app` ジョブ: `./gradlew :app:assembleDebug` / `./gradlew :app:testDebugUnitTest`

## ローカル(Android Studio)でのセットアップ

1. [Android Studio](https://developer.android.com/studio) を開き、このリポジトリをインポート
2. Health Connect アプリを実機/エミュレータにインストール
3. intervals.icu の Settings > Developer Settings で API キーを発行し、アプリの設定画面
   (歯車アイコン)から Athlete ID / API Key を入力
4. `app` の Run Configuration で実行

## 既知の制約 / TODO

- `app/src/main/assets/courses/norikura_echo_line.json` の区間勾配は公式大会要項からの概算値。
  実測GPX(Strava/RideWithGPSなど)に差し替えると予測精度が上がる(`CourseProfile.parse()`が
  JSONを読むだけなので、フォーマットを維持すれば差し替えは容易)。
- AGP/AndroidXの依存バージョンは開発時点で存在確認済みのものを固定しているが、
  この環境ではビルド未検証のため、Android Studio / CIで最新版へのアップグレードを推奨。
- Health Connect の「権限の理由」画面 (`PermissionsRationaleActivity`) は
  `MainActivity` へのプレースホルダー実装。ストア公開時は専用のプライバシーポリシー
  画面への差し替えを推奨。
- 体重・FTPの手動入力フォールバックは未実装(Health Connect/intervals.icu 取得失敗時は
  エラー表示のみ)。
