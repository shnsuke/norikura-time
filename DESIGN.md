# 乗鞍ヒルクライム タイム予測アプリ 設計書

体重・FTP(intervals.icu)・コースプロフィール(乗鞍エコーライン)から、
乗鞍ヒルクライムの完走タイムを物理モデルで予測するアプリの設計。

## 0. 前提・スコープ

- プラットフォーム: **Webアプリ**(Kotlin/Ktorバックエンド + 素のHTML/CSS/JSフロントエンド)
- 経緯: 当初はFlutter → ネイティブAndroid(Health Connectで体重自動取得)の順で設計していたが、
  「ブラウザで使えるWebアプリにしたい」という要望を受け、Health Connect連携を撤去し
  ネイティブAndroidアプリ(`:app`)をKtorサーバー(`:web`)に置き換えた。
  予測ロジックを担う `:core` はプラットフォーム非依存のまま流用している。
- **体重の自動取得は行わない**。HealthKit(iOS)・Health Connect(Android)はいずれも
  OSレベルのAPIでブラウザから汎用的にアクセスする方法が無いため、Web版では手入力とする。
- 対象コース: 乗鞍ヒルクライム(乗鞍エコーライン) — 乗鞍観光センター 〜 畳平口(長野・岐阜県境)
- Gradleマルチモジュール構成。`:core`と`:web`はどちらも純粋なJVMアプリケーションで、
  Android SDKや `dl.google.com` への到達が一切不要なため、この開発環境で最初から最後まで
  ビルド・テスト・起動確認ができた(Android版は`:app`のビルドにAndroid SDKが必要で、
  GitHub Actions上でしか検証できなかった)。

## 1. 全体アーキテクチャ

```
┌─────────────────────────────┐        HTTP (JSON)        ┌────────────────────────────────┐
│   ブラウザ (静的HTML/JS)      │ ─────────────────────────▶ │   :web (Ktor サーバー)           │
│   - 体重・自転車重量を手入力   │                            │   GET  /api/course              │
│   - FTP直接入力 or            │ ◀───────────────────────── │   POST /api/predict             │
│     intervals.icu認証情報入力 │        予測結果(JSON)       │   静的ファイル配信 (index.html)   │
└─────────────────────────────┘                            └───────────────┬──────────────────┘
                                                                             │ 呼び出し
┌────────────────────────────────────────────────────────── :core (純Kotlin/JVM) ─────────────┐
│                                                                                                │
│  IntervalsIcuClient.fetchCurrentFtp(athleteId, apiKey) ──► ftpWatts ─┐                         │
│  CourseProfile.parse(json)  (サーバー起動時にassetsから読み込み)     ─┼─► RiderProfile + CourseProfile │
│                                                                        │                        │
│                                                                        ▼                        │
│                              ClimbPredictionService.predict()                                   │
│                    (物理モデル: 区間ごとに目標W→速度→時間、Newton法で解く)                          │
│                                                                        │                        │
│                                                                        ▼                        │
│                                        ClimbPrediction (結果)                                    │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

外部依存は「intervals.icu REST API」のみ(サーバー側から呼び出し、APIキーはブラウザに
渡らない)。コースプロフィールは外部APIが存在しないため、サーバーにバンドルした
静的アセット(JSON)として持つ。

## 2. ①コースプロフィールの取得

### 2.1 データソースの選定

乗鞍ヒルクライムの公式コースには一般公開APIやGPX配布がないため、以下のいずれかで
静的データを作成し、サーバーにバンドルする方針とする。

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
(`web/src/main/resources/courses/norikura_echo_line.json` を差し替えるだけでよい)。

| 区間 | 距離 | 標高(始→終) | 平均勾配(概算) |
|---|---|---|---|
| 観光センター → 三本滝ゲート | 8.7 km | 1,460m → 1,870m | 約4.7% |
| 三本滝ゲート → 位ヶ原山荘 | 8.3 km | 1,870m → 2,350m | 約6.1%(実測値) |
| 位ヶ原山荘 → ゴール(県境) | 3.5 km | 2,350m → 2,720m | 約10.6% |

### 2.4 実装

- `CourseProfile` / `CourseSegment` (`:core`, kotlinx.serializationで `@Serializable`)
- `CourseProfile.parse(jsonText)` がJSON文字列をパース(単体テスト済み)
- `:web` はサーバー起動時に `resources/courses/norikura_echo_line.json` を読み込み、
  メモリ上に保持して `GET /api/course` で返す

## 3. ②体重の入力

Web版では体重の自動取得は行わない。HealthKit/Health Connectはブラウザから汎用的に
アクセスできるOS APIではないため。フロントエンドのフォームで手入力し、
`POST /api/predict` のリクエストボディ (`weightKg`) として送る。

## 4. ③FTPの取得 (intervals.icu API)

### 4.1 API概要

- ベースURL: `https://intervals.icu/api/v1`
- 認証: HTTP Basic 認証。ユーザー名固定文字列 `API_KEY`、パスワードに
  intervals.icu の Settings > Developer Settings で発行したAPIキーを使用
- エンドポイント: `GET /athlete/{athleteId}` のレスポンス中の `icu_ftp` フィールドを
  現在のFTP(W)として採用する

### 4.2 認証情報の扱い

ブラウザから直接intervals.icuを呼ぶとAPIキーが露出し、CORSの問題も起きうるため、
**サーバー側でプロキシする**。`POST /api/predict` に `ftpWatts` を渡さず
`athleteId`/`apiKey` を渡すと、サーバーが `IntervalsIcuClient` 経由でintervals.icuを
呼び出しFTPを取得してから予測を実行する。APIキーはサーバーに永続保存せず、
リクエストの都度受け取って使い捨てる(個人利用のシンプルな構成のため)。

### 4.3 実装

- `IntervalsIcuClient` (`:core/IntervalsIcuClient.kt`, OkHttpベース。MockWebServerで
  正常系・`icu_ftp`欠落・非2xxレスポンスの3パターンを単体テスト済み)
- `:web` の `POST /api/predict` ハンドラが `ftpWatts` 未指定時に `Dispatchers.IO` 上で呼び出す

## 5. 予測エンジン (物理モデル)

サイクリングパワーモデルの標準式を用い、区間ごとに「目標パワー→定常走行速度→区間タイム」を
算出し合算する。`:core/ClimbPredictionService.kt` に実装(単体テスト済み、変更なし)。

```
P_total = [ m·g·sin(θ)·v          (登坂抵抗)
          + m·g·Crr·cos(θ)·v      (転がり抵抗)
          + 0.5·ρ(h)·CdA·v³       (空気抵抗) ] / η_drivetrain
```

- m: 体重 + 自転車・装備重量 (既定8kg、リクエストで変更可)
- θ: 区間の平均勾配から算出 (atan(gain/distance))
- ρ(h): 標高hにおける空気密度 (気圧の高度補正式で概算。区間ごとに標高中央値で計算)
- Crr = 0.005、CdA = 0.40、η_drivetrain = 0.975

各区間について目標パワー P を既知として、上式を v について解く(3次式 → Newton法)。
区間タイム = 距離 / v。全区間の合計が予測タイム。

### 5.1 目標パワーの決定 (FTPからの逓減)

推定所要時間に応じてFTPに対する割合を逓減させる(45分以内100% 〜 120分超80%)。
初回は95%FTPで全区間を仮計算 → 合計時間から%FTPを再取得 → 収束するまで最大4回反復する。

### 5.2 検証結果

3.0 W/kg(65kg / 195W)のライダーで実際にサーバーを起動し `POST /api/predict` を叩いたところ、
`totalTimeSeconds: 6326` (約105分)という結果を得た。手計算・以前のAndroid版での検証結果と
一致しており、Web版への移植でロジックが壊れていないことを確認済み。

## 6. API / 画面構成

- `GET /api/course` — コースプロフィール(区間ごとの距離・標高)をJSONで返す
- `POST /api/predict` — 予測を実行。リクエスト: `{weightKg, bikeWeightKg?, ftpWatts?, athleteId?, apiKey?}`。
  `ftpWatts`未指定時は`athleteId`/`apiKey`必須。レスポンス: 合計タイム・区間別内訳。
- `GET /` — 静的フロントエンド(`index.html`)。フォームで入力 → `fetch()`で`/api/predict`を呼び、
  結果をテーブル表示する素のHTML/CSS/JS(フレームワーク無し)

## 7. この開発環境での検証状況

`:core`・`:web`ともに純粋なJVMアプリケーションで、Android SDKや`dl.google.com`への
到達が一切不要。そのため、このセッションの開発環境だけで最初から最後まで検証できた:

| 領域 | 検証状況 |
|---|---|
| `:core` (モデル・JSONパース・物理エンジン・intervals.icu HTTPクライアント) | `./gradlew :core:test` で10件のJUnit5テストがgreen |
| `:web` (APIルーティング・DTOシリアライズ・静的配信) | `./gradlew :web:test` で4件の結合テスト(testApplication)がgreen |
| `:web` 実サーバー起動 | `./gradlew :web:run` で起動し、`curl`で `/`, `/api/course`, `/api/predict` の3エンドポイントを実際に叩いて動作確認済み |

(Android版はAndroid SDKが必要な`:app`の検証にGitHub Actionsが必須だったが、
Web版は開発環境だけで完結できるようになった。)

## 8. 未確定事項 / 次のステップ

1. コース区間データを実測GPX(Strava/RWGPS)に差し替えて精度向上
2. デプロイ先の選定(Render/Fly.io/Cloud Run等。`PORT`環境変数には対応済み)
3. 複数人での利用を想定する場合、intervals.icu認証情報の保存(ログイン機能 or
   ブラウザのlocalStorage)を検討
4. HTTPS化・レート制限などの本番運用向け対応
