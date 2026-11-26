package org.lifeos.beta

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.permission.HealthPermission
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.NetworkType
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.concurrent.TimeUnit


internal class HealthExportWorker(
    appContext: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {
    override suspend fun doWork(): Result {
        if (HealthConnectClient.getSdkStatus(applicationContext) != HealthConnectClient.SDK_AVAILABLE) {
            recordStatus("Health Connect ist nicht verfügbar.")
            return Result.retry()
        }

        val client = HealthConnectClient.getOrCreate(applicationContext)
        val granted = client.permissionController.getGrantedPermissions()
        val backgroundAvailable = client.features.getFeatureStatus(
            HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND,
        ) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE
        val required = healthReadPermissions() + if (backgroundAvailable) {
            setOf(HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND)
        } else {
            emptySet()
        }
        if (!granted.containsAll(required)) {
            recordStatus("Mindestens ein Health- oder Hintergrundzugriff fehlt.")
            return Result.failure()
        }

        return try {
            val apiSettings = SecureApiSettings(applicationContext).load()
            if (apiSettings == null) {
                recordStatus("Der Handy-Schreibschlüssel ist noch nicht eingerichtet.")
                return Result.failure()
            }
            val timezone = ZoneId.of("Europe/Berlin")
            val today = LocalDate.now(timezone)
            val completeThrough = today.minusDays(1)
            val wantedDays = completedExportDays(today, EXPORT_DAY_COUNT) + today
            val exporter = HealthConnectExporter(applicationContext)
            val health = exporter.readHealthMetrics(wantedDays)
            val correctionStore = StepCorrectionStore(applicationContext, apiSettings.baseUrl)
            val corrections = wantedDays.mapNotNull { day ->
                correctionStore.get(day)?.let { day to it }
            }.toMap()
            val results = applyStepCorrections(wantedDays, health, corrections)
            val manualStore = ManualEntryStore(applicationContext, apiSettings.baseUrl)
            val manual = manualStore.loadEntries().values
            val uploader = PersonalApiUploader(apiSettings)
            val standard = results.filter(DailyHealthMetrics::hasStandardValue)
            val removed = if (standard.isNotEmpty() || manual.isNotEmpty()) {
                val payload = exporter.createPayload(standard, "scheduled", completeThrough, manual)
                manualStore.acknowledge(uploader.upload(payload))
            } else 0
            uploader.uploadMinimumPulse(results.mapNotNull { entry ->
                entry.minimumHeartRateBpm?.let { entry.day to it }
            }.toMap())
            recordStatus("API-Upload erfolgreich: $completeThrough; manuell bestätigt: $removed")
            Result.success()
        } catch (error: Exception) {
            recordStatus("API-Upload fehlgeschlagen: ${error.javaClass.simpleName}")
            Result.retry()
        }
    }

    private fun recordStatus(message: String) {
        applicationContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_LAST_STATUS, message)
            .putString(KEY_LAST_ATTEMPT, ZonedDateTime.now(ZoneId.of("Europe/Berlin")).toString())
            .apply()
    }

    companion object {
        const val PREFERENCES_NAME = "health_export_status"
        const val KEY_LAST_STATUS = "last_status"
        const val KEY_LAST_ATTEMPT = "last_attempt"
        const val EXPORT_DAY_COUNT = 30
        private const val UNIQUE_WORK_NAME = "gymprogress_nightly_health_export"
        private const val IMMEDIATE_WORK_NAME = "gymprogress_health_export_now"
        private val EXPORT_TIME = LocalTime.of(2, 30)

        fun schedule(context: Context) {
            val now = ZonedDateTime.now(ZoneId.of("Europe/Berlin"))
            val initialDelay = delayUntilNextExport(now, EXPORT_TIME)
            val request = PeriodicWorkRequestBuilder<HealthExportWorker>(24, TimeUnit.HOURS)
                .setInitialDelay(initialDelay)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiresBatteryNotLow(true)
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                UNIQUE_WORK_NAME,
                ExistingPeriodicWorkPolicy.CANCEL_AND_REENQUEUE,
                request,
            )
        }

        fun disable(context: Context) {
            WorkManager.getInstance(context).apply {
                cancelUniqueWork(UNIQUE_WORK_NAME)
                cancelUniqueWork(IMMEDIATE_WORK_NAME)
            }
        }

        fun runNow(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                IMMEDIATE_WORK_NAME,
                ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<HealthExportWorker>()
                    .setConstraints(constraints)
                    .build(),
            )
        }
    }
}
