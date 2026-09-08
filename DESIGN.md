# 乗鞍ヒルクライム タイム予測アプリ 設計書

体重(Health Connect)・FTP(intervals.icu)・コースプロフィール(乗鞍エコーライン)から、
乗鞍ヒルクライムの完走タイムを物理モデルで予測するアプリの設計。

## 0. 前提・スコープ

- プラットフォーム: **ネイティブAndroid (Kotlin + Jetpack Compose)**
  - 当初はFlutter(クロスプラットフォーム)案で設計していたが、実際の開発・検証環境が
    GitHub + Android(iOS実機・Flutter SDKなし)であることを踏まえ、ネイティブAndroidに
    切り替えた。体重取得もiOS HealthKitではなくAndroidの **Health Connect** を使う。
- 対象コース: 乗鞍ヒルクライム(乗鞍エコーライン) — 乗鞍観光センター 〜 畳平口(長野・岐阜県境)
- Gradleマルチモジュール構成とし、Androidに依存しない予測ロジックを `:core` に分離。
  これにより、Android SDKが使えない環境(このセッションのサンドボックス含む)でも
  `:core` は実際にビルド・ユニットテストして動作確認できる。

## 1. 全体アーキテクチャ

```
┌───────────────────────────── :app (Android, Jetpack Compose) ─────────────────────────────┐
│                                                                                              │
│  ┌────────────────────────┐   ┌─────────────────┐   ┌───────────────────────────────────┐  │
│  │ HealthConnectRepository │   │ SettingsRepository│   │      CourseAssetLoader            │  │
│  │ (Health Connect API)    │   │ (EncryptedSharedPreferences: intervals.icu認証情報)         │  │
│  └────────────┬─────────────┘   └────────┬─────────┘   └────────────────┬──────────────────┘  │
│               │ weightKg                 │ athleteId/apiKey             │ assets/JSON        │
│               ▼                          ▼                              ▼                     │
│                                    HomeScreen (Compose UI)                                     │
└───────────────────────────────────────┬──────────────────────────────────────────────────────┘
                                         │ 呼び出し
┌────────────────────────────────────────▼──────────────────────────── :core (純Kotlin/JVM) ───┐
│                                                                                                 │
│  IntervalsIcuClient.fetchCurrentFtp() ──► ftpWatts ─┐                                           │
│  CourseProfile.parse(json)            ──► course   ─┼─► RiderProfile + CourseProfile            │
│                                                       │                                          │
│                                                       ▼                                          │
│                              ClimbPredictionService.predict()                                   │
│                    (物理モデル: 区間ごとに目標W→速度→時間、Newton法で解く)                          │
│                                                       │                                          │
│                                                       ▼                                          │
│                                        ClimbPrediction (結果)                                    │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

外部依存は「Health Connect (OS API)」と「intervals.icu REST API」の2つのみ。コースプロフィールは
外部APIが存在しないため、アプリにバンドルした静的アセット(JSON)として持つ。

`:core` はAndroid/Jetpack依存を一切持たないため、`IntervalsIcuClient`(OkHttp)と
`CourseProfile.parse()`(kotlinx.serialization)、`ClimbPredictionService`(物理エンジン)を
JVM単体テストで検証できる。実際にこのリポジトリでも `./gradlew :core:test` で
CourseProfile/ClimbPredictionService/IntervalsIcuClient(MockWebServerでHTTPをモック)の
計10件のテストがgreenであることを確認済み。

## 2. ①コースプロフィールの取得

### 2.1 データソースの選定

乗鞍ヒルクライムの公式コースには一般公開APIやGPX配布がないため、以下のいずれかで
静的データを作成し、アプリにバンドルする方針とする。

- 公式サイトの大会要項(距離・標高差・平均勾配・関門)を基に区間分割データを作成 (採用)
- 将来的に Strava セグメント / RideWithGPS の GPX をエクスポートし、より高解像度
  (100m〜200mピッチ)の標高プロファイルに差し替え可能な設計にしておく

### 2.2 確認済みコース情報 (2026年大会要項ベース)

| 項目 | 値 |
|---|---|
| 全長 | 20.5 km |
| 標高差 | 1,260 m |
| 平均勾配 | 6.1 % |
| スタート標高 | 約 1,460 m (乗鞍観光センター) |
| ゴール標高 | 2,720 m (国内舗装路最高点・長野岐阜県境) |
| 主要中間点 | 三本滝ゲート(マイカー規制区間開始) → 位ヶ原山荘(標高2,350m) |
| 三本滝 〜 位ヶ原山荘 | 8.3 km / 平均勾配 6.1% |

出典: 乗鞍ヒルクライム2026公式サイト、bikeclimbjournal.com の乗鞍エコーライン記事 (Web検索で確認)。
※ 2026年大会は大雨により中止となったが、コースプロフィール自体は例年と同一。

### 2.3 区間データモデル

上記の確定区間(三本滝〜位ヶ原山荘 8.3km)から逆算し、スタート〜三本滝、位ヶ原山荘〜ゴールを
概算で3区間に分割した。**区間ごとの勾配は概算値であり、実測GPXに差し替え可能な設計とする**
(`app/src/main/assets/courses/norikura_echo_line.json` を差し替えるだけでよい)。

| 区間 | 距離 | 標高(始→終) | 平均勾配(概算) |
|---|---|---|---|
| 観光センター → 三本滝ゲート | 8.7 km | 1,460m → 1,870m | 約4.7% |
| 三本滝ゲート → 位ヶ原山荘 | 8.3 km | 1,870m → 2,350m | 約6.1%(実測値) |
| 位ヶ原山荘 → ゴール(県境) | 3.5 km | 2,350m → 2,720m | 約10.6% |

将来的に区間をさらに細かく(1kmピッチなど)刻むほど予測精度が上がる。JSONのsegments配列に
要素を追加するだけで対応できる。

### 2.4 実装

- `CourseProfile` / `CourseSegment` (`:core`, kotlinx.serializationで `@Serializable`)
- `CourseProfile.parse(jsonText)` がJSON文字列をパース(単体テスト済み)
- `CourseAssetLoader` (`:app`) が `assets/courses/norikura_echo_line.json` を読み込み、
  `CourseProfile.parse()` に渡す

## 3. ②体重の取得 (Health Connect)

### 3.1 方式

AndroidX の `androidx.health.connect:connect-client` を使用。

1. `HealthConnectClient.getSdkStatus()` でHealth Connectアプリの有無を確認
2. `HealthPermission.getReadPermission(WeightRecord::class)` の読み取り権限を
   `PermissionController.createRequestPermissionResultContract()` でリクエスト
   (Compose の `rememberLauncherForActivityResult` で呼び出す)
3. 直近90日分の `WeightRecord` を `readRecords()` で取得し、`time` が最新のものを採用
4. `record.weight.inKilograms` でkg単位を取得

### 3.2 権限・OS設定

- `AndroidManifest.xml` に `android.permission.health.READ_WEIGHT` を宣言
- Health Connect アプリ (`com.google.android.apps.healthdata`) を検出するための `<queries>` 宣言
- targetSdk 34+では権限リクエスト理由画面 (`ACTION_SHOW_PERMISSIONS_RATIONALE`) への
  導線も必要 (`MainActivity` へのプレースホルダー実装済み。ストア公開時は要差し替え)

### 3.3 実装

- `HealthConnectRepository` (`:app/data/HealthConnectRepository.kt`)
- 権限拒否・データなしの場合はUI側でエラー表示(手動入力は今後対応予定)

## 4. ③FTPの取得 (intervals.icu API)

### 4.1 API概要

- ベースURL: `https://intervals.icu/api/v1`
- 認証: HTTP Basic 認証。ユーザー名固定文字列 `API_KEY`、パスワードに
  intervals.icu の Settings > Developer Settings で発行したAPIキーを使用
- エンドポイント: `GET /athlete/{athleteId}` のレスポンス中の `icu_ftp` フィールドを
  現在のFTP(W)として採用する
  - 種目別に明示的に設定されたFTPを使いたい場合は
    `GET /athlete/{athleteId}/sport-settings/{type}` (例: `Ride`) の `ftp` フィールドを使う
    (将来拡張)

### 4.2 認証情報の保存

- Athlete ID と APIキーは `EncryptedSharedPreferences` (Android Keystore由来の鍵で暗号化) に保存
- 設定画面 (`SettingsScreen`) で入力・保存

### 4.3 実装

- `IntervalsIcuClient` (`:core/IntervalsIcuClient.kt`, OkHttpベース。MockWebServerで
  正常系・`icu_ftp`欠落・非2xxレスポンスの3パターンを単体テスト済み)
- 通信失敗時は例外をUI側でキャッチしエラー表示

## 5. 予測エンジン (物理モデル)

サイクリングパワーモデルの標準式を用い、区間ごとに「目標パワー→定常走行速度→区間タイム」を
算出し合算する。`:core/ClimbPredictionService.kt` に実装(単体テスト済み)。

```
P_total = [ m·g·sin(θ)·v          (登坂抵抗)
          + m·g·Crr·cos(θ)·v      (転がり抵抗)
          + 0.5·ρ(h)·CdA·v³       (空気抵抗) ] / η_drivetrain
```

- m: 体重 + 自転車・装備重量 (既定8kg、設定で変更可)
- θ: 区間の平均勾配から算出 (atan(gain/distance))
- ρ(h): 標高hにおける空気密度 (気圧の高度補正式で概算。乗鞍は標高1,460〜2,720mまで
  上昇するため終盤ほど空気抵抗が下がる → 区間ごとに標高中央値で計算)
- Crr = 0.005 (舗装路・良コンディション目安)
- CdA = 0.40 (登坂ポジションの目安値、設定で変更可)
- η_drivetrain = 0.975

各区間について目標パワー P を既知として、上式を v について解く(3次式 → Newton法で数値的に解く)。
区間タイム = 距離 / v。全区間の合計が予測タイム。

### 5.1 目標パワーの決定 (FTPからの逓減)

ヒルクライムは1時間を大きく超えることが多く、FTP(60分基準値)をそのまま出し続けるのは
非現実的なため、推定所要時間に応じてFTPに対する割合を逓減させる。

| 推定所要時間 | 目標強度(%FTP) |
|---|---|
| 〜45分 | 100% |
| 〜60分 | 95% |
| 〜90分 | 90% |
| 〜120分 | 85% |
| 120分〜 | 80% |

初回は95%FTPで全区間を仮計算 → 合計時間から%FTPを再取得 → 収束するまで最大4回反復する。

### 5.2 検証結果

3.0 W/kg(65kg / 195W)のライダーで試算すると、予測タイムは約100分前後となり、
乗鞍ヒルクライムの実際の完走タイム分布(中級者で90〜120分程度)と概ね整合する
(`ClimbPredictionServiceTest` で60〜160分のレンジに収まることを確認)。

## 6. 画面構成

- `HomeScreen`: 「体重・FTP・コースを取得して予測」ボタン → Health Connect権限確認/リクエスト
  → 体重・FTP・コースを取得 → 予測結果(合計タイム、区間別内訳)を表示
- `SettingsScreen`: intervals.icu の Athlete ID / APIキー、自転車重量を設定

## 7. この開発環境での検証状況と役割分担

このセッションのサンドボックス環境は Java 21 / Gradle は使えるが、Android SDKは未導入で
`dl.google.com` (Android Gradle Plugin・AndroxX・Health Connectライブラリの配布元) への
到達がネットワークポリシーでブロックされている。そのため:

| 領域 | 検証状況 |
|---|---|
| `:core` (モデル・JSONパース・物理エンジン・intervals.icu HTTPクライアント) | **このリポジトリで実際にビルド・テスト済み**。`./gradlew :core:test --configure-on-demand` で計10件のJUnit5テストがgreen |
| `:app` (Health Connect連携・Compose UI・Android Manifest) | 未検証。Android SDKが必要なため、GitHub Actions (`.github/workflows/android-ci.yml`) 上でビルド・テストする設計とした |

この分割自体が設計判断: 予測ロジックという「正しさが重要でテストで担保すべき部分」を
Androidから切り離すことで、Android実行環境が無くても本質的なロジックの検証ができるようにした。

## 8. 未確定事項 / 次のステップ

1. コース区間データを実測GPX(Strava/RWGPS)に差し替えて精度向上
2. GitHub Actions (`android-ci.yml`) を実際に走らせ、`:app` のビルド・テストをgreenにする
   (AGP/AndroidXバージョンの解決や実際のコンパイルエラーはCI側で初めて検出できる)
3. Health Connect の「権限の理由」画面の本実装、ストア公開に向けたプライバシーポリシー整備
4. 体重・FTP取得に失敗した場合の手動入力フォールバックの実装
5. intervals.icu APIキーの取得導線 (Settings > Developer Settings) をオンボーディングUIに追加
