package org.lifeos.beta

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate


internal data class ManualColorOption(
    val label: String,
    val argb: Int,
)


internal val PHASE_OPTIONS = listOf(
    ManualColorOption("Maingaining", 0xFF808080.toInt()),
    ManualColorOption("Cut", 0xFFFF4000.toInt()),
    ManualColorOption("Agressive Cut", 0xFFFF0000.toInt()),
    ManualColorOption("Lean Bulk", 0xFF00A933.toInt()),
    ManualColorOption("Bulk", 0xFF158466.toInt()),
    ManualColorOption("Unsure", 0xFFFFFF00.toInt()),
    ManualColorOption("Intuitive", 0xFF2A6099.toInt()),
    ManualColorOption("Reintroducing", 0xFFFFBF00.toInt()),
)


internal val TRAINING_OPTIONS = listOf(
    ManualColorOption("Im Gym gewesen", 0xFF00A933.toInt()),
    ManualColorOption("Restday", 0xFFFFFF00.toInt()),
    ManualColorOption("Krank", 0xFFFF0000.toInt()),
    ManualColorOption("Geskippt", 0xFFC9211E.toInt()),
    ManualColorOption("Urlaub", 0xFF2A6099.toInt()),
    ManualColorOption("Homegym", 0xFFD4EA6B.toInt()),
)


internal data class ManualEntry(
    val day: LocalDate,
    val revision: Long,
    val cyclingKm: Double? = null,
    val training: String? = null,
    val targetPhase: String? = null,
    val currentPhase: String? = null,
    val sleepScore: Int? = null,
    val notes: String? = null,
) {
    fun hasAnyValue(): Boolean = listOf(
        cyclingKm,
        training,
        targetPhase,
        currentPhase,
        sleepScore,
        notes,
    ).any { it != null }
}


internal fun validateManualEntry(entry: ManualEntry): ManualEntry {
    require(entry.revision >= 0) { "Die Revision darf nicht negativ sein." }
    entry.cyclingKm?.let {
        require(it.isFinite() && it in 0.0..1_000.0) {
            "Fahrradkilometer müssen zwischen 0 und 1.000 liegen."
        }
    }
    entry.sleepScore?.let {
        require(it in 0..100) { "Sleep Score muss zwischen 0 und 100 liegen." }
    }
    fun validateChoice(value: String?, options: List<ManualColorOption>, label: String) {
        if (value != null) {
            require(options.any { it.label == value }) { "Ungültige Auswahl für $label." }
        }
    }
    validateChoice(entry.training, TRAINING_OPTIONS, "Training")
    validateChoice(entry.targetPhase, PHASE_OPTIONS, "Zielphase")
    validateChoice(entry.currentPhase, PHASE_OPTIONS, "Aktuelle Phase")
    val normalizedNotes = entry.notes
        ?.trim()
        ?.split(Regex("\\s+"))
        ?.filter { it.isNotEmpty() }
        ?.joinToString(" ")
        ?.takeIf { it.isNotEmpty() }
    require(normalizedNotes == null || normalizedNotes.length <= 1_000) {
        "Sonstiges darf höchstens 1.000 Zeichen enthalten."
    }
    val normalized = entry.copy(notes = normalizedNotes)
    require(normalized.hasAnyValue()) { "Bitte mindestens einen Tageswert eingeben." }
    return normalized
}


internal fun acknowledgeManualEntries(
    entries: Map<LocalDate, ManualEntry>,
    acknowledgements: Map<LocalDate, Long>,
): Map<LocalDate, ManualEntry> = entries.filterValues { entry ->
    acknowledgements[entry.day] != entry.revision
}


internal fun manualEntriesToJson(entries: Collection<ManualEntry>): JSONArray = JSONArray().apply {
    entries.sortedBy { it.day }.forEach { entry ->
        val values = JSONObject()
        entry.cyclingKm?.let { values.put("cycling_km", it) }
        entry.training?.let { values.put("training", it) }
        entry.targetPhase?.let { values.put("target_phase", it) }
        entry.currentPhase?.let { values.put("current_phase", it) }
        entry.sleepScore?.let { values.put("sleep_score", it) }
        entry.notes?.let { values.put("notes", it) }
        put(
            JSONObject()
                .put("date", entry.day.toString())
                .put("revision", entry.revision)
                .put("values", values),
        )
    }
}


private fun manualEntriesFromJson(contents: String?): Map<LocalDate, ManualEntry> {
    if (contents.isNullOrBlank()) return emptyMap()
    val array = JSONArray(contents)
    val result = linkedMapOf<LocalDate, ManualEntry>()
    for (index in 0 until array.length()) {
        val raw = array.getJSONObject(index)
        val values = raw.getJSONObject("values")
        val day = LocalDate.parse(raw.getString("date"))
        check(day !in result) { "Ein manuelles Datum kommt doppelt vor." }
        val knownKeys = setOf(
            "cycling_km",
            "training",
            "target_phase",
            "current_phase",
            "sleep_score",
            "notes",
        )
        val unknownKeys = values.keys().asSequence().filter { it !in knownKeys }.toList()
        check(unknownKeys.isEmpty()) { "Unbekannte manuelle Felder: ${unknownKeys.joinToString()}" }
        val entry = ManualEntry(
            day = day,
            revision = raw.getLong("revision"),
            cyclingKm = values.optDoubleOrNull("cycling_km"),
            training = values.optStringOrNull("training"),
            targetPhase = values.optStringOrNull("target_phase"),
            currentPhase = values.optStringOrNull("current_phase"),
            sleepScore = values.optIntOrNull("sleep_score"),
            notes = values.optStringOrNull("notes"),
        )
        result[day] = validateManualEntry(entry).also {
            check(it.revision > 0) { "Gespeicherte Revision muss positiv sein." }
        }
    }
    return result
}


private fun JSONObject.optDoubleOrNull(key: String): Double? =
    if (has(key) && !isNull(key)) getDouble(key) else null


private fun JSONObject.optIntOrNull(key: String): Int? =
    if (has(key) && !isNull(key)) getInt(key) else null


private fun JSONObject.optStringOrNull(key: String): String? =
    if (has(key) && !isNull(key)) getString(key) else null


internal class ManualEntryStore(context: Context, baseUrl: String = DashboardConnection(context).destination()) {
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME + dashboardScope(baseUrl), Context.MODE_PRIVATE)

    @Synchronized
    fun loadEntries(): Map<LocalDate, ManualEntry> = manualEntriesFromJson(
        preferences.getString(KEY_ENTRIES, null),
    )

    @Synchronized
    fun loadConfirmedEntries(): Map<LocalDate, ManualEntry> = manualEntriesFromJson(
        preferences.getString(KEY_CONFIRMED_ENTRIES, null),
    )

    @Synchronized
    fun entryFor(day: LocalDate): ManualEntry? = loadEntries()[day] ?: loadConfirmedEntries()[day]

    @Synchronized
    fun pendingEntryFor(day: LocalDate): ManualEntry? = loadEntries()[day]

    @Synchronized
    fun confirmedEntryFor(day: LocalDate): ManualEntry? = loadConfirmedEntries()[day]

    @Synchronized
    fun upsert(draft: ManualEntry): ManualEntry {
        val revision = preferences.getLong(KEY_NEXT_REVISION, 1L).coerceAtLeast(1L)
        val saved = validateManualEntry(draft.copy(revision = revision))
        val entries = loadEntries().toMutableMap().apply { put(saved.day, saved) }
        persist(entries, revision + 1L)
        return saved
    }

    @Synchronized
    fun remove(day: LocalDate): Boolean {
        val entries = loadEntries().toMutableMap()
        if (entries.remove(day) == null) return false
        persist(entries, preferences.getLong(KEY_NEXT_REVISION, 1L).coerceAtLeast(1L))
        return true
    }

    @Synchronized
    fun acknowledge(encoded: String): Int {
        val acknowledgements = parseAcknowledgements(encoded)
        if (acknowledgements.isEmpty()) return 0
        val entries = loadEntries()
        val retained = acknowledgeManualEntries(entries, acknowledgements)
        val removed = entries.size - retained.size
        if (removed > 0) {
            val confirmed = loadConfirmedEntries().toMutableMap()
            entries.forEach { (day, entry) ->
                if (acknowledgements[day] == entry.revision) confirmed[day] = entry
            }
            persist(
                retained,
                preferences.getLong(KEY_NEXT_REVISION, 1L).coerceAtLeast(1L),
                confirmed,
            )
        }
        return removed
    }

    private fun persist(
        entries: Map<LocalDate, ManualEntry>,
        nextRevision: Long,
        confirmed: Map<LocalDate, ManualEntry> = loadConfirmedEntries(),
    ) {
        val saved = preferences.edit()
            .putString(KEY_ENTRIES, manualEntriesToJson(entries.values).toString())
            .putString(KEY_CONFIRMED_ENTRIES, manualEntriesToJson(confirmed.values).toString())
            .putLong(KEY_NEXT_REVISION, nextRevision)
            .commit()
        check(saved) { "Manuelle Tageswerte konnten nicht gespeichert werden." }
    }

    companion object {
        private const val PREFERENCES_NAME = "manual_entries"
        private const val KEY_ENTRIES = "entries_json"
        private const val KEY_CONFIRMED_ENTRIES = "confirmed_entries_json"
        private const val KEY_NEXT_REVISION = "next_revision"

        private fun parseAcknowledgements(encoded: String): Map<LocalDate, Long> =
            encoded.split(',')
                .mapNotNull { token ->
                    val parts = token.split(':', limit = 2)
                    if (parts.size != 2) return@mapNotNull null
                    val day = runCatching { LocalDate.parse(parts[0]) }.getOrNull()
                        ?: return@mapNotNull null
                    val revision = parts[1].toLongOrNull()?.takeIf { it > 0 }
                        ?: return@mapNotNull null
                    day to revision
                }
                .toMap()
    }
}
