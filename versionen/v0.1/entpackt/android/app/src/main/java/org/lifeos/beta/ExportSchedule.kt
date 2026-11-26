package org.lifeos.beta

import java.time.Duration
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZonedDateTime


internal fun delayUntilNextExport(
    now: ZonedDateTime,
    scheduledTime: LocalTime,
): Duration {
    var next = now.toLocalDate().atTime(scheduledTime).atZone(now.zone)
    if (!next.isAfter(now)) {
        next = now.toLocalDate().plusDays(1).atTime(scheduledTime).atZone(now.zone)
    }
    return Duration.between(now, next)
}


internal fun completedExportDays(today: LocalDate, count: Int): List<LocalDate> {
    require(count > 0) { "Die Anzahl der Exporttage muss positiv sein." }
    return (count downTo 1).map { today.minusDays(it.toLong()) }
}
