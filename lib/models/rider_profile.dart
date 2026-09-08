/// 予測に使うライダー情報。体重はHealthアプリ、FTPはintervals.icuから取得する。
class RiderProfile {
  final double weightKg;
  final double bikeWeightKg;
  final int ftpWatts;

  /// 空気抵抗係数 (CdA, m^2)。登坂ポジションの目安値。
  final double cda;

  /// 転がり抵抗係数。
  final double crr;

  /// ドライブトレイン効率 (0〜1)。
  final double drivetrainEfficiency;

  const RiderProfile({
    required this.weightKg,
    this.bikeWeightKg = 8.0,
    required this.ftpWatts,
    this.cda = 0.40,
    this.crr = 0.005,
    this.drivetrainEfficiency = 0.975,
  });

  double get totalMassKg => weightKg + bikeWeightKg;

  double get wattsPerKg => weightKg == 0 ? 0 : ftpWatts / weightKg;

  RiderProfile copyWith({
    double? weightKg,
    double? bikeWeightKg,
    int? ftpWatts,
    double? cda,
    double? crr,
    double? drivetrainEfficiency,
  }) {
    return RiderProfile(
      weightKg: weightKg ?? this.weightKg,
      bikeWeightKg: bikeWeightKg ?? this.bikeWeightKg,
      ftpWatts: ftpWatts ?? this.ftpWatts,
      cda: cda ?? this.cda,
      crr: crr ?? this.crr,
      drivetrainEfficiency:
          drivetrainEfficiency ?? this.drivetrainEfficiency,
    );
  }
}
