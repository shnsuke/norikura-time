package dev.norikuratime.core

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.sin
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

/**
 * 物理モデルに基づき、区間ごとの目標パワーから速度・タイムを算出し合算する。
 * Androidに依存しない純Kotlinロジック(JVM単体テスト可能)。
 */
class ClimbPredictionService {

    /** 与えられたライダー・コースからタイムを予測する。 */
    fun predict(course: CourseProfile, rider: RiderProfile): ClimbPrediction {
        var intensity = 0.95 // 初期仮定 (%FTP)
        var segmentPredictions: List<SegmentPrediction> = emptyList()

        for (iteration in 0 until 4) {
            val targetPower = rider.ftpWatts * intensity
            segmentPredictions = course.segments.map { segment ->
                val speedMs = solveSpeedMs(targetPower, segment, rider)
                val speedKmh = speedMs * 3.6
                val time = if (speedMs <= 0.0) {
                    Int.MAX_VALUE.seconds
                } else {
                    Math.round(segment.distanceM / speedMs).toInt().seconds
                }
                SegmentPrediction(
                    segment = segment,
                    targetPowerWatts = targetPower,
                    speedKmh = speedKmh,
                    time = time,
                )
            }

            val totalTime = segmentPredictions.fold(Duration.ZERO) { acc, s -> acc + s.time }
            val nextIntensity = targetIntensity(totalTime)
            if (abs(nextIntensity - intensity) < 0.001) break
            intensity = nextIntensity
        }

        return ClimbPrediction(course = course, rider = rider, segments = segmentPredictions)
    }

    /** 標高hにおける空気密度の概算(バロメトリック近似)。 */
    fun airDensityAt(elevationM: Double): Double =
        SEA_LEVEL_AIR_DENSITY * exp(-elevationM / SCALE_HEIGHT_M)

    /**
     * 与えられたパワー・勾配・質量・標高から定常走行速度(m/s)をNewton法で解く。
     * P = [m*g*sin(θ)*v + m*g*Crr*cos(θ)*v + 0.5*ρ*CdA*v^3] / η
     */
    private fun solveSpeedMs(powerWatts: Double, segment: CourseSegment, rider: RiderProfile): Double {
        if (powerWatts <= 0) return 0.0

        val theta = segment.gradientAngleRad
        val rho = airDensityAt(segment.midElevationM)
        val m = rider.totalMassKg

        val linearCoeff = m * GRAVITY * (sin(theta) + rider.crr * cos(theta))
        val cubicCoeff = 0.5 * rho * rider.cda
        val eta = rider.drivetrainEfficiency

        var v = 5.0 // 初期値 (m/s)
        for (i in 0 until 50) {
            val f = (linearCoeff * v + cubicCoeff * v * v * v) / eta - powerWatts
            val fPrime = (linearCoeff + 3 * cubicCoeff * v * v) / eta
            if (abs(fPrime) < 1e-9) break
            val next = v - f / fPrime
            if (next <= 0) {
                v /= 2
                continue
            }
            if (abs(next - v) < 1e-6) {
                v = next
                break
            }
            v = next
        }
        return v
    }

    /** 推定所要時間に応じたFTPに対する目標強度(%)。 */
    private fun targetIntensity(estimatedDuration: Duration): Double {
        val minutes = estimatedDuration.inWholeSeconds / 60.0
        return when {
            minutes <= 45 -> 1.00
            minutes <= 60 -> 0.95
            minutes <= 90 -> 0.90
            minutes <= 120 -> 0.85
            else -> 0.80
        }
    }

    companion object {
        private const val GRAVITY = 9.81 // m/s^2
        private const val SEA_LEVEL_AIR_DENSITY = 1.225 // kg/m^3
        private const val SCALE_HEIGHT_M = 8500.0 // 気圧の高度減衰スケール
    }
}
