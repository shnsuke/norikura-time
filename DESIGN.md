# 乗鞍ヒルクライム タイム予測アプリ 設計書

体重(Health アプリ)・FTP(intervals.icu)・コースプロフィール(乗鞍エコーライン)から、
乗鞍ヒルクライムの完走タイムを物理モデルで予測するアプリの設計。

## 0. 前提・スコープ

- プラットフォーム: **Flutter (iOS / Android クロスプラットフォーム)**
  - 体重取得は iOS = HealthKit、Android = Health Connect を `health` パッケージ経由で吸収する。
- 対象コース: 乗鞍ヒルクライム(乗鞍エコーライン) — 乗鞍観光センター 〜 畳平口(長野・岐阜県境)
- 本ドキュメントは①コースプロフィール取得、②体重取得、③FTP取得、④予測エンジンの4点を設計し、
  Flutterプロジェクトの実装土台をリポジトリに用意する。

## 1. 全体アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                        Flutter App                            │
│                                                                 │
│  ┌───────────────┐   ┌───────────────────┐   ┌──────────────┐ │
│  │ HealthService  │   │ IntervalsIcuService│   │CourseRepository│ │
│  │ (health pkg)   │   │ (REST + APIキー)   │   │ (bundled JSON) │ │
│  └───────┬────────┘   └─────────┬──────────┘   └──────┬───────┘ │
│          │ weightKg             │ ftpWatts             │ course │
│          ▼                      ▼                      ▼        │
│               RiderProfile ─────┴───────────── CourseProfile     │
│                        │                              │          │
│                        ▼                              ▼          │
│               ┌────────────────────────────────────────┐        │
│               │        ClimbPredictionService            │       │
│               │  (物理モデル: 区間ごとに目標W→速度→時間)    │       │
│               └────────────────────┬─────────────────────┘       │
│                                     ▼                             │
│                            ClimbPrediction (結果)                 │
│                                     ▼                             │
│                              HomeScreen (UI表示)                  │
└─────────────────────────────────────────────────────────────┘
        ▲                       ▲                        ▲
        │ HealthKit /           │ HTTPS Basic Auth       │ アプリ内蔵
        │ Health Connect        │ (APIキーは             │ アセット
        │ (OS権限)              │  secure storage保存)    │ (JSON)
```

外部依存は「Health OS API」と「intervals.icu REST API」の2つのみ。コースプロフィールは
外部APIが存在しないため、アプリにバンドルした静的データとして持つ（後述）。

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
(`assets/courses/norikura_echo_line.json` を差し替えるだけでよい)。

| 区間 | 距離 | 標高(始→終) | 平均勾配(概算) |
|---|---|---|---|
| 観光センター → 三本滝ゲート | 8.7 km | 1,460m → 1,870m | 約4.7% |
| 三本滝ゲート → 位ヶ原山荘 | 8.3 km | 1,870m → 2,350m | 約6.1%(実測値) |
| 位ヶ原山荘 → ゴール(県境) | 3.5 km | 2,350m → 2,720m | 約10.6% |

将来的に区間をさらに細かく(1kmピッチなど)刻むほど予測精度が上がる。JSONのsegments配列に
要素を追加するだけで対応できる。

### 2.4 実装

- `CourseProfile` / `CourseSegment` モデル (`lib/models/`)
- `CourseRepository.loadNorikuraEcholine()` が `assets/courses/norikura_echo_line.json` を
  `rootBundle` 経由で読み込みパースする

## 3. ②体重の取得 (Health アプリ連携)

### 3.1 方式

Flutter の `health` パッケージ (iOS: HealthKit / Android: Health Connect のラッパー) を使用。

1. `Health().configure()` で初期化
2. `HealthDataType.WEIGHT` に対する読み取り権限を `requestAuthorization` でリクエスト
3. 直近90日分の `WEIGHT` レコードを取得し、`dateTo` が最新のものを採用
4. kg単位に正規化して `RiderProfile.weightKg` にセット

### 3.2 権限・OS設定

- iOS: `Info.plist` に `NSHealthShareUsageDescription` を追加、Xcodeで HealthKit Capability を有効化
- Android: `Health Connect` アプリのインストールが前提。`AndroidManifest.xml` に
  health permission を宣言

これらは `flutter create` 実行後、ネイティブプロジェクトに対して行う設定のため、
実装土台では `HealthService` (Dart側ロジック)のみを用意し、ネイティブ設定はREADMEに
手順を記載する。

### 3.3 実装

- `HealthService.fetchLatestWeightKg()` (`lib/services/health_service.dart`)
- 権限拒否・データなしの場合は手動入力にフォールバックできるようUI側で許容する

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

- Athlete ID と APIキーは `flutter_secure_storage` (iOS Keychain / Android Keystore) に保存
- 設定画面 (`SettingsScreen`) で入力・保存

### 4.3 実装

- `IntervalsIcuService.fetchCurrentFtp()` (`lib/services/intervals_icu_service.dart`)
- 通信失敗時は前回キャッシュ値 or 手動入力にフォールバック

## 5. 予測エンジン (物理モデル)

サイクリングパワーモデルの標準式を用い、区間ごとに「目標パワー→定常走行速度→区間タイム」を
算出し合算する。

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

初回は95%FTPで全区間を仮計算 → 合計時間から%FTPを再取得 → 収束するまで2〜3回反復する。

### 5.2 実装

- `ClimbPredictionService.predict(CourseProfile, RiderProfile)` (`lib/services/climb_prediction_service.dart`)
- Flutter非依存の純Dartロジックとして実装し、単体テスト可能にする (`test/climb_prediction_service_test.dart`)

## 6. 画面構成

- `HomeScreen`: 「体重・FTP・コースを取得して予測」ボタン → 3つのサービスを並列取得 →
  予測結果(合計タイム、区間別内訳)を表示
- `SettingsScreen`: intervals.icu の Athlete ID / APIキー、自転車重量、CdA等の物理パラメータを設定

## 7. 未確定事項 / 次のステップ

1. コース区間データを実測GPX(Strava/RWGPS)に差し替えて精度向上
2. `health` パッケージのバージョンに応じたAPI差異の確認 (`flutter pub get` はSDK未導入のためこの
   セッションでは未実施)
3. `flutter create .` をローカルで実行し `android/` `ios/` のネイティブプロジェクトを生成、
   HealthKit Capability・Health Connect permission を設定
4. intervals.icu APIキーの取得導線 (Settings > Developer Settings) をオンボーディングUIに追加
