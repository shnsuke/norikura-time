package dev.norikuratime.app.data

import android.content.Context
import dev.norikuratime.core.CourseProfile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * コースプロフィールの取得。外部APIが存在しないため、アプリにバンドルした
 * assets 内の静的JSONを読み込み、パースは :core の CourseProfile.parse() に委譲する。
 */
class CourseAssetLoader(private val context: Context) {

    suspend fun loadNorikuraEcholine(): CourseProfile = withContext(Dispatchers.IO) {
        val json = context.assets.open(NORIKURA_ASSET_PATH).bufferedReader().use { it.readText() }
        CourseProfile.parse(json)
    }

    companion object {
        private const val NORIKURA_ASSET_PATH = "courses/norikura_echo_line.json"
    }
}
