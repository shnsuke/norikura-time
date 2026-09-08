package dev.norikuratime.core

/**
 * 予測に使うライダー情報。体重はHealth Connect、FTPはintervals.icuから取得する想定。
 */
data class RiderProfile(
    val weightKg: Double,
    val bikeWeightKg: Double = 8.0,
    val ftpWatts: Int,
    /** 空気抵抗係数 (CdA, m^2)。登坂ポジションの目安値。 */
    val cda: Double = 0.40,
    /** 転がり抵抗係数。 */
    val crr: Double = 0.005,
    /** ドライブトレイン効率 (0〜1)。 */
    val drivetrainEfficiency: Double = 0.975,
) {
    val totalMassKg: Double get() = weightKg + bikeWeightKg
    val wattsPerKg: Double get() = if (weightKg == 0.0) 0.0 else ftpWatts / weightKg
}
