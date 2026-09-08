package dev.norikuratime.app.data

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * 体重の取得。Android の Health Connect (androidx.health.connect) から
 * 直近の体重レコードを読み取る。
 *
 * 事前に Health Connect アプリ (com.google.android.apps.healthdata) のインストールと、
 * READ_WEIGHT 権限の許可が必要。
 */
class HealthConnectRepository(private val context: Context) {

    val requiredPermissions: Set<String> =
        setOf(HealthPermission.getReadPermission(WeightRecord::class))

    val permissionRequestContract = PermissionController.createRequestPermissionResultContract()

    fun isAvailable(): Boolean =
        HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE

    suspend fun hasAllPermissions(): Boolean {
        val client = HealthConnectClient.getOrCreate(context)
        val granted = client.permissionController.getGrantedPermissions()
        return granted.containsAll(requiredPermissions)
    }

    /** 直近90日以内で最新の体重(kg)を返す。データが無い場合はnull。 */
    suspend fun fetchLatestWeightKg(lookbackDays: Long = 90): Double? {
        val client = HealthConnectClient.getOrCreate(context)
        val now = Instant.now()
        val start = now.minus(lookbackDays, ChronoUnit.DAYS)

        val response = client.readRecords(
            ReadRecordsRequest(
                recordType = WeightRecord::class,
                timeRangeFilter = TimeRangeFilter.between(start, now),
            ),
        )

        return response.records
            .maxByOrNull { it.time }
            ?.weight
            ?.inKilograms
    }
}
