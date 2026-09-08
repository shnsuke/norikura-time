package dev.norikuratime.core

import kotlin.time.Duration

/** 1区間の予測結果。 */
data class SegmentPrediction(
    val segment: CourseSegment,
    val targetPowerWatts: Double,
    val speedKmh: Double,
    val time: Duration,
)

/** コース全体の予測結果。 */
data class ClimbPrediction(
    val course: CourseProfile,
    val rider: RiderProfile,
    val segments: List<SegmentPrediction>,
) {
    val totalTime: Duration
        get() = segments.fold(Duration.ZERO) { acc, s -> acc + s.time }

    val averagePowerWatts: Double
        get() {
            val totalSeconds = totalTime.inWholeSeconds
            if (totalSeconds == 0L) return 0.0
            val weightedSum = segments.sumOf { it.targetPowerWatts * it.time.inWholeSeconds }
            return weightedSum / totalSeconds
        }
}
