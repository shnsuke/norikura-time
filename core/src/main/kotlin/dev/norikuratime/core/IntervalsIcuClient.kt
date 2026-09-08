package dev.norikuratime.core

import java.util.concurrent.TimeUnit
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.Credentials
import okhttp3.OkHttpClient
import okhttp3.Request

class IntervalsIcuException(message: String) : Exception(message)

@Serializable
private data class AthleteResponse(val icu_ftp: Int? = null)

/**
 * FTPの取得。intervals.icu REST APIをHTTP Basic認証
 * (username固定 "API_KEY", passwordに発行済みAPIキー) で呼び出す。
 *
 * 参照: https://intervals.icu/features/open-api/
 *
 * Androidに依存しない純Kotlin/OkHttpロジック(JVM単体テスト可能。MockWebServerでテスト済み)。
 */
class IntervalsIcuClient(
    private val baseUrl: String = "https://intervals.icu/api/v1",
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build(),
) {
    private val json = Json { ignoreUnknownKeys = true }

    /**
     * 現在のFTP(W)を取得する。intervals.icuが算出する `icu_ftp` を使用する。
     * 特定種目(Rideなど)に手動設定されたFTPを使いたい場合は
     * `/athlete/{id}/sport-settings/{type}` の `ftp` フィールドを参照すること(将来拡張)。
     */
    fun fetchCurrentFtp(athleteId: String, apiKey: String): Int {
        val request = Request.Builder()
            .url("$baseUrl/athlete/$athleteId")
            .header("Authorization", Credentials.basic("API_KEY", apiKey))
            .get()
            .build()

        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw IntervalsIcuException("intervals.icu API error: ${response.code} $body")
            }
            val athlete = json.decodeFromString(AthleteResponse.serializer(), body)
            return athlete.icu_ftp
                ?: throw IntervalsIcuException("icu_ftp field not found in response")
        }
    }
}
