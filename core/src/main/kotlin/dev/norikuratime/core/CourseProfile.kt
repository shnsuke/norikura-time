package dev.norikuratime.core

import kotlin.math.atan
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * コースの一区間。距離と標高の始点・終点から平均勾配を導出する。
 */
@Serializable
data class CourseSegment(
    val name: String,
    val startDistanceKm: Double,
    val endDistanceKm: Double,
    val startElevationM: Double,
    val endElevationM: Double,
) {
    val distanceKm: Double get() = endDistanceKm - startDistanceKm
    val distanceM: Double get() = distanceKm * 1000
    val elevationGainM: Double get() = endElevationM - startElevationM

    /** 平均勾配 (0.061 = 6.1%) */
    val averageGradient: Double get() = if (distanceM == 0.0) 0.0 else elevationGainM / distanceM

    /** 勾配角(ラジアン)。水平距離ベースの近似。 */
    val gradientAngleRad: Double get() = atan(averageGradient)

    /** 区間の標高中央値。空気密度計算に使用。 */
    val midElevationM: Double get() = (startElevationM + endElevationM) / 2
}

/**
 * コース全体のプロファイル(複数区間の集合)。
 */
@Serializable
data class CourseProfile(
    val id: String,
    val name: String,
    val source: String = "",
    val segments: List<CourseSegment>,
) {
    val totalDistanceKm: Double get() = segments.sumOf { it.distanceKm }
    val totalElevationGainM: Double get() = segments.sumOf { it.elevationGainM }
    val averageGradient: Double
        get() = if (totalDistanceKm == 0.0) 0.0 else totalElevationGainM / (totalDistanceKm * 1000)

    companion object {
        private val json = Json { ignoreUnknownKeys = true }

        /** コースプロフィールのJSON文字列をパースする。 */
        fun parse(jsonText: String): CourseProfile = json.decodeFromString(serializer(), jsonText)
    }
}
