package dev.norikuratime.app.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

data class IntervalsIcuCredentials(val athleteId: String, val apiKey: String)

/**
 * intervals.icu の認証情報や物理パラメータ設定を EncryptedSharedPreferences
 * (Android Keystore 由来の鍵で暗号化) に保存する。
 */
class SettingsRepository(context: Context) {

    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        PREFS_FILE_NAME,
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun saveIntervalsIcuCredentials(credentials: IntervalsIcuCredentials) {
        prefs.edit()
            .putString(KEY_ATHLETE_ID, credentials.athleteId)
            .putString(KEY_API_KEY, credentials.apiKey)
            .apply()
    }

    fun loadIntervalsIcuCredentials(): IntervalsIcuCredentials? {
        val athleteId = prefs.getString(KEY_ATHLETE_ID, null)
        val apiKey = prefs.getString(KEY_API_KEY, null)
        if (athleteId.isNullOrBlank() || apiKey.isNullOrBlank()) return null
        return IntervalsIcuCredentials(athleteId, apiKey)
    }

    fun saveBikeWeightKg(weightKg: Double) {
        prefs.edit().putFloat(KEY_BIKE_WEIGHT, weightKg.toFloat()).apply()
    }

    fun loadBikeWeightKg(): Double? {
        if (!prefs.contains(KEY_BIKE_WEIGHT)) return null
        return prefs.getFloat(KEY_BIKE_WEIGHT, 0f).toDouble()
    }

    companion object {
        private const val PREFS_FILE_NAME = "norikura_time_settings"
        private const val KEY_ATHLETE_ID = "intervals_icu_athlete_id"
        private const val KEY_API_KEY = "intervals_icu_api_key"
        private const val KEY_BIKE_WEIGHT = "bike_weight_kg"
    }
}
