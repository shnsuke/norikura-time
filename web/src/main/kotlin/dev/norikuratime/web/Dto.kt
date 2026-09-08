package dev.norikuratime.web

import dev.norikuratime.core.ClimbPrediction
import kotlinx.serialization.Serializable

@Serializable
data class PredictRequest(
    val weightKg: Double,
    val bikeWeightKg: Double? = null,
    val ftpWatts: Int? = null,
    val athleteId: String? = null,
    val apiKey: String? = null,
)

@Serializable
data class SegmentPredictionDto(
    val name: String,
    val distanceKm: Double,
    val averageGradientPercent: Double,
    val targetPowerWatts: Double,
    val speedKmh: Double,
    val timeSeconds: Long,
)

@Serializable
data class PredictResponse(
    val totalTimeSeconds: Long,
    val averagePowerWatts: Double,
    val weightKg: Double,
    val ftpWatts: Int,
    val wattsPerKg: Double,
    val segments: List<SegmentPredictionDto>,
)

fun ClimbPrediction.toDto(): PredictResponse = PredictResponse(
    totalTimeSeconds = totalTime.inWholeSeconds,
    averagePowerWatts = averagePowerWatts,
    weightKg = rider.weightKg,
    ftpWatts = rider.ftpWatts,
    wattsPerKg = rider.wattsPerKg,
    segments = segments.map { s ->
        SegmentPredictionDto(
            name = s.segment.name,
            distanceKm = s.segment.distanceKm,
            averageGradientPercent = s.segment.averageGradient * 100,
            targetPowerWatts = s.targetPowerWatts,
            speedKmh = s.speedKmh,
            timeSeconds = s.time.inWholeSeconds,
        )
    },
)

@Serializable
data class ErrorResponse(val error: String)
