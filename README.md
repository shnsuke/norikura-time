# norikura-time

体重・FTP(intervals.icu)・コースプロフィール(乗鞍エコーライン)から乗鞍ヒルクライムの
完走タイムを予測する **Webアプリ**。バックエンドはKotlin製(Ktor)。

設計の詳細は [DESIGN.md](./DESIGN.md) を参照。

> 元はAndroidネイティブアプリ(Health Connectで体重を自動取得)として作っていましたが、
> ブラウザから使えるWebアプリへの仕様変更に伴い、Health Connect連携を撤去し
> ネイティブAndroidアプリ(`:app`)をKtorサーバー(`:web`)に置き換えました。
> 予測エンジン(`:core`)はそのまま流用しています。
>
> **Web版では体重は手入力**です(HealthKit/Health Connectはブラウザから
> 汎用的にアクセスできるAPIが無いため)。intervals.icuのAPIキーはブラウザに
> 露出させず、サーバー側からFTPを取得します。

## この環境で実際にビルド・起動確認済み

`:core` も `:web` も純粋なJVMアプリケーションで、Android SDKや`dl.google.com`への
到達が不要なため、このリポジトリの開発環境で最初から最後まで動作確認できた
(以前のAndroid版はAndroid SDKが必要でGitHub Actions頼みだった)。

```sh
./gradlew :core:test   # 予測エンジンの単体テスト (10件, green)
./gradlew :web:test    # APIエンドポイントの結合テスト (4件, green)
./gradlew :web:run     # サーバー起動 (http://localhost:8080)
```

`:web:run` で起動した状態で実際に以下を確認済み:

```sh
curl http://localhost:8080/api/course
curl -X POST http://localhost:8080/api/predict \
  -H "Content-Type: application/json" \
  -d '{"weightKg":65.0,"ftpWatts":195}'
# => {"totalTimeSeconds":6326, ...}  (約105分。手計算・Android版と同じ結果)
```

## モジュール構成

```
core/   # 純Kotlin/JVMモジュール (Androidにもサーバーにも依存しない)
  CourseProfile.kt / CourseSegment.kt  # ①コースプロフィール(JSONパース含む)
  RiderProfile.kt                       # ②③体重・FTPを保持するライダー情報
  ClimbPredictionService.kt             # 物理モデルによるタイム予測エンジン
  IntervalsIcuClient.kt                 # ③FTP取得 (intervals.icu REST API, OkHttp)
  src/test/                             # JUnit5単体テスト

web/    # Ktorサーバー (バックエンド + 静的フロントエンド配信)
  Application.kt   # ルーティング: GET /api/course, POST /api/predict, 静的配信
  Dto.kt           # APIリクエスト/レスポンスのDTOとシリアライズ
  src/main/resources/static/index.html   # フロントエンド(素のHTML/CSS/JS)
  src/main/resources/courses/norikura_echo_line.json
  src/test/                              # testApplication によるAPI結合テスト
```

## API

- `GET /api/course` — コースプロフィール(区間ごとの距離・標高)を返す
- `POST /api/predict` — 予測を実行する
  ```json
  {
    "weightKg": 65.0,
    "bikeWeightKg": 8.0,
    "ftpWatts": 195
  }
  ```
  `ftpWatts` の代わりに `athleteId` / `apiKey` を渡すと、サーバー側でintervals.icuから
  FTPを取得する。

## ローカル実行

```sh
./gradlew :web:run
# ブラウザで http://localhost:8080 を開く
```

デプロイ時は `PORT` 環境変数でリッスンポートを指定できる(RenderやFly.io等のPaaSを想定)。

## GitHub Actions CI

`.github/workflows/ci.yml` で `core`/`web` 両モジュールをpush/PRごとにビルド・テストする。
どちらも純JVMのため、Android SDKのセットアップは不要。

## 既知の制約 / TODO

- `web/src/main/resources/courses/norikura_echo_line.json` の区間勾配は公式大会要項からの
  概算値。実測GPX(Strava/RideWithGPSなど)に差し替えると予測精度が上がる。
- 体重は毎回手入力(自動取得は無し)。intervals.icuのAthlete ID/APIKeyも毎回フォーム入力
  (サーバー側に永続保存はしない)。複数人で使う想定なら、ログイン機能や
  ブラウザのlocalStorageへの保存を追加するとよい。
- intervals.icu呼び出しは同期HTTP(OkHttp)を`Dispatchers.IO`でラップしているだけの
  簡易実装。高負荷が想定される場合はコネクションプール等の調整を検討。
- HTTPS化やレート制限は未実装。個人利用を想定したシンプルな構成。
