package org.lifeos.beta

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.NutritionRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter


internal class HealthConnectExporter(private val context: Context) {
    private val timezone = ZoneId.of("Europe/Berlin")
    private val client = HealthConnectClient.getOrCreate(context)

    suspend fun readHealthMetrics(days: List<LocalDate>): List<DailyHealthMetrics> =
        days.mapNotNull { day -> readDay(day).takeIf { it.hasAnyValue() } }

    suspend fun readMinimumPulse(days: List<LocalDate>): Map<LocalDate, Long> =
        days.mapNotNull { day ->
            val start = day.atStartOfDay(timezone).toInstant()
            val end = day.plusDays(1).atStartOfDay(timezone).toInstant()
            val minimum = client.aggregate(AggregateRequest(
                metrics = setOf(HeartRateRecord.BPM_MIN),
                timeRangeFilter = TimeRangeFilter.between(start, end),
            ))[HeartRateRecord.BPM_MIN]
            minimum?.let { day to it }
        }.toMap()

    data class StepReading(val count: Long, val source: String)

    suspend fun readPreferredSteps(day: LocalDate): StepReading? {
        val start = day.atStartOfDay(timezone).toInstant()
        val end = day.plusDays(1).atStartOfDay(timezone).toInstant()
        val googleHealthSteps = client.aggregate(
            AggregateRequest(
                metrics = setOf(StepsRecord.COUNT_TOTAL),
                timeRangeFilter = TimeRangeFilter.between(start, end),
                dataOriginFilter = setOf(DataOrigin("com.fitbit.FitbitMobile")),
            ),
        )[StepsRecord.COUNT_TOTAL]
        if (googleHealthSteps != null) return StepReading(googleHealthSteps, "Google Health")
        val combinedSteps = client.aggregate(
            AggregateRequest(
                metrics = setOf(StepsRecord.COUNT_TOTAL),
                timeRangeFilter = TimeRangeFilter.between(start, end),
            ),
        )[StepsRecord.COUNT_TOTAL]
        return combinedSteps?.let { StepReading(it, "Health Connect") }
    }

    private suspend fun readDay(day: LocalDate): DailyHealthMetrics {
        val start = day.atStartOfDay(timezone).toInstant()
        val end = day.plusDays(1).atStartOfDay(timezone).toInstant()
        val aggregate = client.aggregate(
            AggregateRequest(
                metrics = setOf(
                    NutritionRecord.ENERGY_TOTAL,
                    RestingHeartRateRecord.BPM_AVG,
                    HeartRateRecord.BPM_MIN,
                ),
                timeRangeFilter = TimeRangeFilter.between(start, end),
            ),
        )
        val weight = client.readRecords(
            ReadRecordsRequest(
                recordType = WeightRecord::class,
                timeRangeFilter = TimeRangeFilter.between(start, end),
                ascendingOrder = true,
            ),
        ).records.lastOrNull()?.weight?.inKilograms
        val steps = readPreferredSteps(day)?.count
        val sleepSessions = readSleepSessions(day)
        val sleepSummary = combineSleepSummaries(
            sleepSessions.map(::summarizeSleepSession),
        )
        val mainSleepSession = sleepSessions.maxByOrNull {
            Duration.between(it.startTime, it.endTime)
        }
        val sleepHeartRate = mainSleepSession?.let {
            client.aggregate(
                AggregateRequest(
                    metrics = setOf(HeartRateRecord.BPM_AVG),
                    timeRangeFilter = TimeRangeFilter.between(it.startTime, it.endTime),
                ),
            )[HeartRateRecord.BPM_AVG]?.toDouble()
        }
        return DailyHealthMetrics(
            day = day,
            steps = steps,
            weightKg = weight,
            nutritionKcal = aggregate[NutritionRecord.ENERGY_TOTAL]?.inKilocalories,
            sleepDurationMinutes = sleepSummary?.sleepMinutes,
            deepSleepMinutes = sleepSummary?.deepMinutes,
            deepSleepPhases = sleepSummary?.deepPhases,
            lightSleepMinutes = sleepSummary?.lightMinutes,
            lightSleepPhases = sleepSummary?.lightPhases,
            remSleepMinutes = sleepSummary?.remMinutes,
            remSleepPhases = sleepSummary?.remPhases,
            awakeMinutes = sleepSummary?.awakeMinutes,
            awakePhases = sleepSummary?.awakePhases,
            restingHeartRateBpm = aggregate[RestingHeartRateRecord.BPM_AVG]?.toDouble(),
            sleepHeartRateBpm = sleepHeartRate,
            minimumHeartRateBpm = aggregate[HeartRateRecord.BPM_MIN],
        )
    }

    private suspend fun readSleepSessions(day: LocalDate): List<SleepSessionRecord> {
        val windowStart = day.minusDays(1).atStartOfDay(timezone).toInstant()
        val windowEnd = day.plusDays(1).atStartOfDay(timezone).toInstant()
        val sessions = client.readRecords(
            ReadRecordsRequest(
                recordType = SleepSessionRecord::class,
                timeRangeFilter = TimeRangeFilter.between(windowStart, windowEnd),
                ascendingOrder = true,
            ),
        ).records
            .filter { it.endTime.atZone(timezone).toLocalDate() == day }
        val selected = mutableListOf<SleepSessionRecord>()
        sessions
            .sortedByDescending { Duration.between(it.startTime, it.endTime) }
            .forEach { candidate ->
                val overlaps = selected.any { existing ->
                    candidate.startTime < existing.endTime &&
                        candidate.endTime > existing.startTime
                }
                if (!overlaps) selected += candidate
            }
        return selected.sortedBy { it.startTime }
    }

    private fun summarizeSleepSession(session: SleepSessionRecord): SleepSummary =
        summarizeSleep(
            sessionStart = session.startTime,
            sessionEnd = session.endTime,
            stages = session.stages.map { stage ->
                SleepStageSlice(
                    start = stage.startTime,
                    end = stage.endTime,
                    kind = when (stage.stage) {
                        SleepSessionRecord.STAGE_TYPE_DEEP -> SleepStageKind.DEEP
                        SleepSessionRecord.STAGE_TYPE_LIGHT -> SleepStageKind.LIGHT
                        SleepSessionRecord.STAGE_TYPE_REM -> SleepStageKind.REM
                        SleepSessionRecord.STAGE_TYPE_AWAKE,
                        SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED,
                        SleepSessionRecord.STAGE_TYPE_OUT_OF_BED,
                        -> SleepStageKind.AWAKE
                        SleepSessionRecord.STAGE_TYPE_SLEEPING -> SleepStageKind.GENERIC_SLEEP
                        else -> SleepStageKind.UNKNOWN
                    },
                )
            },
        )

    fun createPayload(
        results: List<DailyHealthMetrics>,
        exportMode: String,
        completeThrough: LocalDate? = null,
        manualEntries: Collection<ManualEntry> = emptyList(),
    ): JSONObject {
        val days = JSONArray()
        results.forEach { result ->
            val entry = JSONObject().put("date", result.day.toString())
            result.steps?.let { entry.put("steps", it) }
            result.weightKg?.let { entry.put("weight_kg", it) }
            result.nutritionKcal?.let { entry.put("nutrition_kcal", it) }
            result.sleepDurationMinutes?.let { entry.put("sleep_duration_minutes", it) }
            result.deepSleepMinutes?.let { entry.put("deep_sleep_minutes", it) }
            result.deepSleepPhases?.let { entry.put("deep_sleep_phases", it) }
            result.lightSleepMinutes?.let { entry.put("light_sleep_minutes", it) }
            result.lightSleepPhases?.let { entry.put("light_sleep_phases", it) }
            result.remSleepMinutes?.let { entry.put("rem_sleep_minutes", it) }
            result.remSleepPhases?.let { entry.put("rem_sleep_phases", it) }
            result.awakeMinutes?.let { entry.put("awake_minutes", it) }
            result.awakePhases?.let { entry.put("awake_phases", it) }
            result.restingHeartRateBpm?.let { entry.put("resting_heart_rate_bpm", it) }
            result.sleepHeartRateBpm?.let { entry.put("sleep_heart_rate_bpm", it) }
            days.put(entry)
        }
        return JSONObject()
            .put("schema_version", 4)
            .put("source", "android-health-connect")
            .put("timezone", "Europe/Berlin")
            .put("export_mode", exportMode)
            .put(
                "generated_at",
                ZonedDateTime.now(timezone).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME),
            )
            .apply {
                if (completeThrough != null) {
                    put("complete_through", completeThrough.toString())
                }
            }
            .put("days", days)
            .put("manual_entries", manualEntriesToJson(manualEntries))
    }

    fun saveExport(contents: String): Uri {
        val fileName = "health_connect_data.json"
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            val directory = File(
                context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
                "GymProgress",
            )
            check(directory.exists() || directory.mkdirs()) {
                "Exportordner konnte nicht erstellt werden."
            }
            val file = File(directory, fileName)
            file.writeText(contents, Charsets.UTF_8)
            return Uri.fromFile(file)
        }

        val resolver = context.contentResolver
        val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
        val relativePath = "${Environment.DIRECTORY_DOWNLOADS}/GymProgress/"
        resolver.delete(
            collection,
            "${MediaStore.MediaColumns.DISPLAY_NAME}=? AND ${MediaStore.MediaColumns.RELATIVE_PATH}=?",
            arrayOf(fileName, relativePath),
        )

        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
            put(MediaStore.MediaColumns.MIME_TYPE, "application/json")
            put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = checkNotNull(resolver.insert(collection, values)) {
            "Exportdatei konnte nicht angelegt werden."
        }
        try {
            resolver.openOutputStream(uri, "w")!!.bufferedWriter(Charsets.UTF_8).use {
                it.write(contents)
            }
            values.clear()
            values.put(MediaStore.MediaColumns.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            return uri
        } catch (error: Exception) {
            resolver.delete(uri, null, null)
            throw error
        }
    }
}
