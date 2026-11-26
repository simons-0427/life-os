package org.lifeos.beta

import android.content.Context
import java.time.LocalDate


internal class StepCorrectionStore(context: Context, baseUrl: String = DashboardConnection(context).destination()) {
    private val preferences = context.getSharedPreferences("step_corrections" + dashboardScope(baseUrl), Context.MODE_PRIVATE)

    fun get(day: LocalDate): Long? =
        if (preferences.contains(day.toString())) preferences.getLong(day.toString(), 0L) else null

    fun save(day: LocalDate, steps: Long) {
        require(steps in 0L..100_000L) { "Schritte müssen zwischen 0 und 100.000 liegen." }
        check(preferences.edit().putLong(day.toString(), steps).commit()) {
            "Die Schritt-Korrektur konnte nicht gespeichert werden."
        }
    }

    fun remove(day: LocalDate) {
        check(preferences.edit().remove(day.toString()).commit()) {
            "Die Schritt-Korrektur konnte nicht entfernt werden."
        }
    }
}

internal fun applyStepCorrections(
    days: List<LocalDate>,
    health: List<DailyHealthMetrics>,
    corrections: Map<LocalDate, Long>,
): List<DailyHealthMetrics> {
    val healthByDay = health.associateBy(DailyHealthMetrics::day)
    return days.mapNotNull { day ->
        val observed = healthByDay[day]
        val correctedSteps = corrections[day]
        if (correctedSteps == null) observed else {
            (observed ?: DailyHealthMetrics(day)).copy(steps = correctedSteps)
        }
    }
}
