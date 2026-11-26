package org.lifeos.beta

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import kotlin.math.roundToLong


internal enum class SleepStageKind {
    DEEP,
    LIGHT,
    REM,
    AWAKE,
    GENERIC_SLEEP,
    UNKNOWN,
}


internal data class SleepStageSlice(
    val start: Instant,
    val end: Instant,
    val kind: SleepStageKind,
)


internal data class SleepSummary(
    val sleepMinutes: Long,
    val deepMinutes: Long?,
    val deepPhases: Int?,
    val lightMinutes: Long?,
    val lightPhases: Int?,
    val remMinutes: Long?,
    val remPhases: Int?,
    val awakeMinutes: Long?,
    val awakePhases: Int?,
)


internal fun combineSleepSummaries(summaries: List<SleepSummary>): SleepSummary? {
    if (summaries.isEmpty()) return null

    fun sumMinutes(selector: (SleepSummary) -> Long?): Long? {
        val values = summaries.mapNotNull(selector)
        return values.takeIf { it.isNotEmpty() }?.sum()
    }

    fun sumPhases(selector: (SleepSummary) -> Int?): Int? {
        val values = summaries.mapNotNull(selector)
        return values.takeIf { it.isNotEmpty() }?.sum()
    }

    return SleepSummary(
        sleepMinutes = summaries.sumOf { it.sleepMinutes },
        deepMinutes = sumMinutes { it.deepMinutes },
        deepPhases = sumPhases { it.deepPhases },
        lightMinutes = sumMinutes { it.lightMinutes },
        lightPhases = sumPhases { it.lightPhases },
        remMinutes = sumMinutes { it.remMinutes },
        remPhases = sumPhases { it.remPhases },
        awakeMinutes = sumMinutes { it.awakeMinutes },
        awakePhases = sumPhases { it.awakePhases },
    )
}


internal data class DailyHealthMetrics(
    val day: LocalDate,
    val steps: Long? = null,
    val weightKg: Double? = null,
    val nutritionKcal: Double? = null,
    val sleepDurationMinutes: Long? = null,
    val deepSleepMinutes: Long? = null,
    val deepSleepPhases: Int? = null,
    val lightSleepMinutes: Long? = null,
    val lightSleepPhases: Int? = null,
    val remSleepMinutes: Long? = null,
    val remSleepPhases: Int? = null,
    val awakeMinutes: Long? = null,
    val awakePhases: Int? = null,
    val restingHeartRateBpm: Double? = null,
    val sleepHeartRateBpm: Double? = null,
    val minimumHeartRateBpm: Long? = null,
) {
    fun hasAnyValue(): Boolean = minimumHeartRateBpm != null || hasStandardValue()

    fun hasStandardValue(): Boolean = listOf(
        steps,
        weightKg,
        nutritionKcal,
        sleepDurationMinutes,
        deepSleepMinutes,
        lightSleepMinutes,
        remSleepMinutes,
        awakeMinutes,
        restingHeartRateBpm,
        sleepHeartRateBpm,
    ).any { it != null }
}


internal fun summarizeSleep(
    sessionStart: Instant,
    sessionEnd: Instant,
    stages: List<SleepStageSlice>,
): SleepSummary {
    require(sessionEnd.isAfter(sessionStart)) { "Das Ende muss nach dem Start liegen." }
    val sessionMillis = Duration.between(sessionStart, sessionEnd).toMillis()
    val normalized = stages.mapNotNull { stage ->
        val start = maxOf(stage.start, sessionStart)
        val end = minOf(stage.end, sessionEnd)
        if (end.isAfter(start)) stage.copy(start = start, end = end) else null
    }
    fun minutes(kind: SleepStageKind): Long = normalized
        .filter { it.kind == kind }
        .sumOf { Duration.between(it.start, it.end).toMillis() }
        .div(60_000.0)
        .roundToLong()
    fun phases(kind: SleepStageKind): Int = normalized.count { it.kind == kind }

    val detailed = normalized.any {
        it.kind == SleepStageKind.DEEP ||
            it.kind == SleepStageKind.LIGHT ||
            it.kind == SleepStageKind.REM
    }
    val deep = minutes(SleepStageKind.DEEP)
    val light = minutes(SleepStageKind.LIGHT)
    val rem = minutes(SleepStageKind.REM)
    val awake = minutes(SleepStageKind.AWAKE)
    val genericSleep = minutes(SleepStageKind.GENERIC_SLEEP)
    val unknown = minutes(SleepStageKind.UNKNOWN)
    // The phone's displayed sleep total includes very short awake intervals.
    // Keep exactly three-minute intervals excluded to match the verified export.
    val shortAwakeMinutes = normalized
        .filter { stage ->
            stage.kind == SleepStageKind.AWAKE &&
                Duration.between(stage.start, stage.end) < Duration.ofMinutes(3)
        }
        .sumOf { Duration.between(it.start, it.end).toMillis() }
        .div(60_000.0)
        .roundToLong()
    val coveredMillis = normalized
        .sumOf { Duration.between(it.start, it.end).toMillis() }
        .coerceAtMost(sessionMillis)
    val uncoveredMinutes = ((sessionMillis - coveredMillis) / 60_000.0).roundToLong()
    val sleepMinutes = (
        deep + light + rem + genericSleep + unknown + uncoveredMinutes + shortAwakeMinutes
        )
        .coerceAtLeast(0)
    return SleepSummary(
        sleepMinutes = sleepMinutes,
        deepMinutes = if (detailed) deep else null,
        deepPhases = if (detailed) phases(SleepStageKind.DEEP) else null,
        lightMinutes = if (detailed) light else null,
        lightPhases = if (detailed) phases(SleepStageKind.LIGHT) else null,
        remMinutes = if (detailed) rem else null,
        remPhases = if (detailed) phases(SleepStageKind.REM) else null,
        awakeMinutes = if (detailed || awake > 0) awake else null,
        awakePhases = if (detailed || awake > 0) phases(SleepStageKind.AWAKE) else null,
    )
}
