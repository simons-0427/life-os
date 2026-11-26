package org.lifeos.beta

import android.app.AlertDialog
import android.app.DatePickerDialog
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Typeface
import android.graphics.Color
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale


private data class ManualUiOption(
    val label: String,
    val argb: Int?,
) {
    override fun toString(): String = label
}


private class ManualOptionAdapter(
    context: Context,
    options: List<ManualUiOption>,
) : ArrayAdapter<ManualUiOption>(context, android.R.layout.simple_spinner_item, options) {
    private val density = context.resources.displayMetrics.density

    override fun getView(position: Int, convertView: View?, parent: ViewGroup): View =
        optionView(position, convertView, dropdown = false)

    override fun getDropDownView(position: Int, convertView: View?, parent: ViewGroup): View =
        optionView(position, convertView, dropdown = true)

    private fun optionView(position: Int, convertView: View?, dropdown: Boolean): TextView {
        val view = (convertView as? TextView) ?: TextView(context)
        val option = checkNotNull(getItem(position))
        view.text = option.label
        view.textSize = 16f
        view.gravity = Gravity.CENTER_VERTICAL
        val horizontal = (14 * density).toInt()
        val vertical = ((if (dropdown) 13 else 11) * density).toInt()
        view.setPadding(horizontal, vertical, horizontal, vertical)
        view.setBackgroundColor(option.argb ?: Color.TRANSPARENT)
        view.setTextColor(option.argb?.let(::contrastingTextColor) ?: Color.DKGRAY)
        return view
    }

    private fun contrastingTextColor(background: Int): Int {
        val luminance = (
            0.299 * Color.red(background) +
                0.587 * Color.green(background) +
                0.114 * Color.blue(background)
            )
        return if (luminance >= 160) Color.BLACK else Color.WHITE
    }
}


class MainActivity : ComponentActivity() {
    private val timezone = ZoneId.of("Europe/Berlin")
    private val healthConnectClient by lazy { HealthConnectClient.getOrCreate(this) }
    private val manualEntryStore by lazy { ManualEntryStore(this) }
    private val stepCorrectionStore by lazy { StepCorrectionStore(this) }
    private val apiSettings by lazy { SecureApiSettings(this) }
    private val apiHistoryStore by lazy { ApiHistoryStore(this) }
    private var apiRecords: List<ApiRecord> = emptyList()
    private var apiHistoryLoading = false
    private val uploadStatusListener = SharedPreferences.OnSharedPreferenceChangeListener { prefs, key ->
        if (key == HealthExportWorker.KEY_LAST_STATUS &&
            prefs.getString(key, "")?.startsWith("API-Upload erfolgreich") == true) {
            runOnUiThread { refreshApiHistory() }
        }
    }

    private lateinit var statusText: TextView
    private lateinit var exportButton: Button
    private lateinit var apiKeyInput: EditText
    private lateinit var apiStatusText: TextView
    private lateinit var apiHistoryStatusText: TextView
    private lateinit var apiHistoryDateButton: Button
    private lateinit var apiHistoryValuesText: TextView
    private lateinit var healthConnectStepsText: TextView
    private var healthStepsRequestId = 0
    private lateinit var manualDateButton: Button
    private lateinit var manualExistingValuesText: TextView
    private lateinit var manualCyclingInput: EditText
    private lateinit var manualSleepScoreInput: EditText
    private lateinit var manualTrainingSpinner: Spinner
    private lateinit var manualTargetPhaseSpinner: Spinner
    private lateinit var manualCurrentPhaseSpinner: Spinner
    private lateinit var manualNotesInput: EditText
    private lateinit var manualRemoveButton: Button
    private lateinit var manualStatusText: TextView
    private var manualFormBaseline: List<String>? = null
    private var selectedManualDay = LocalDate.now(timezone)

    private val permissionLauncher = registerForActivityResult(
        PermissionController.createRequestPermissionResultContract(),
    ) { granted ->
        val required = requiredPermissions()
        if (granted.containsAll(required)) {
            HealthExportWorker.schedule(this)
            HealthExportWorker.runNow(this)
            statusText.text =
                "Zugriff erteilt. Der erste API-Upload läuft; danach täglich ungefähr 02:30 Uhr."
            exportButton.isEnabled = true
        } else {
            statusText.text =
                "Ohne alle Gesundheits- und Hintergrundzugriffe ist kein Vollimport möglich."
            exportButton.isEnabled = false
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (intent.action == Intent.ACTION_MAIN && intent.hasCategory(Intent.CATEGORY_LAUNCHER)) {
            startActivity(Intent(this, DashboardActivity::class.java))
            finish()
            return
        }
        apiRecords = runCatching { apiHistoryStore.load() }.getOrDefault(emptyList())
        setContentView(buildContent())
    }

    override fun onResume() {
        super.onResume()
        if (::statusText.isInitialized) {
            refreshPermissionState()
            getSharedPreferences(HealthExportWorker.PREFERENCES_NAME, MODE_PRIVATE)
                .registerOnSharedPreferenceChangeListener(uploadStatusListener)
            refreshApiHistory()
            refreshSelectedDayHealthSteps()
        }
    }

    override fun onPause() {
        getSharedPreferences(HealthExportWorker.PREFERENCES_NAME, MODE_PRIVATE)
            .unregisterOnSharedPreferenceChangeListener(uploadStatusListener)
        super.onPause()
    }

    private fun buildContent(): ScrollView {
        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(42), dp(24), dp(32))
        }

        container.addView(TextView(this).apply {
            text = "Life OS\nHealth Connect"
            textSize = 28f
            setTypeface(typeface, Typeface.BOLD)
            gravity = Gravity.CENTER
        })
        container.addView(TextView(this).apply {
            text = (
                "Die Brücke liest Gewicht, Ernährungskalorien, Schritte, " +
                    "Schlaf und Puls aus Health Connect. Eigene Tageswerte können " +
                    "direkt darunter gespeichert werden. Die App sendet beides " +
                    "verschlüsselt per HTTPS an die persönliche API."
                )
            textSize = 16f
            setPadding(0, dp(18), 0, dp(24))
        })

        buildApiContent(container, ::dp)

        statusText = TextView(this).apply {
            text = "Health Connect wird geprüft …"
            textSize = 16f
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }
        container.addView(
            statusText,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )

        container.addView(Button(this).apply {
            text = "Alle Health-Zugriffe erlauben"
            setOnClickListener { permissionLauncher.launch(requiredPermissions()) }
        }, matchWidthParams())

        exportButton = Button(this).apply {
            text = "30 Tage und heute jetzt an API senden"
            isEnabled = false
            setOnClickListener { exportRecentHealth() }
        }
        container.addView(exportButton, matchWidthParams())

        buildManualContent(container, ::dp)

        container.addView(TextView(this).apply {
            text = (
                "Automatik: Handy-Upload ungefähr 02:30 Uhr; Windows prüft jede volle Stunde.\n" +
                    "Manuelle Werte werden direkt nach dem Speichern gesendet und bleiben " +
                    "bis zur Serverbestätigung auf dem Handy. Handy und PC müssen nicht im selben WLAN sein."
                )
            textSize = 13f
            setPadding(0, dp(20), 0, 0)
        })

        return ScrollView(this).apply { addView(container) }
    }

    private fun buildApiContent(container: LinearLayout, dp: (Int) -> Int) {
        container.addView(TextView(this).apply {
            text = "Persönliche API"
            textSize = 21f
            setTypeface(typeface, Typeface.BOLD)
        }, matchWidthParams())
        container.addView(TextView(this).apply {
            text = DashboardConnection(this@MainActivity).destination()
            textSize = 13f
            setTextColor(Color.DKGRAY)
        }, matchWidthParams())
        apiKeyInput = EditText(this).apply {
            hint = "Handy-Schreibschlüssel (gpw_…)"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            maxLines = 1
        }
        container.addView(apiKeyInput, matchWidthParams())
        container.addView(Button(this).apply {
            text = "Schreibschlüssel sicher speichern"
            setOnClickListener { saveApiKey() }
        }, matchWidthParams())
        apiStatusText = TextView(this).apply {
            textSize = 13f
            setPadding(0, dp(8), 0, dp(16))
            text = if (runCatching { apiSettings.isConfigured() }.getOrDefault(false)) {
                "Schreibschlüssel ist geschützt im Android Keystore hinterlegt."
            } else {
                "Noch kein Schreibschlüssel gespeichert."
            }
        }
        container.addView(apiStatusText, matchWidthParams())

        container.addView(TextView(this).apply {
            text = "Werte in der API"
            textSize = 21f
            setTypeface(typeface, Typeface.BOLD)
        }, matchWidthParams())
        apiHistoryStatusText = TextView(this).apply {
            textSize = 14f
            setPadding(0, dp(8), 0, dp(8))
        }
        container.addView(apiHistoryStatusText, matchWidthParams())
        apiHistoryDateButton = Button(this).apply {
            setOnClickListener { showApiHistoryDatePicker() }
        }
        container.addView(apiHistoryDateButton, matchWidthParams())
        healthConnectStepsText = TextView(this).apply {
            textSize = 14f
            setPadding(0, dp(8), 0, 0)
        }
        container.addView(healthConnectStepsText, matchWidthParams())
        container.addView(Button(this).apply {
            text = "Gespeicherte Tage auswählen"
            setOnClickListener { showStoredApiDays() }
        }, matchWidthParams())
        container.addView(Button(this).apply {
            text = "API-Werte aktualisieren"
            setOnClickListener { refreshApiHistory() }
        }, matchWidthParams())
        apiHistoryValuesText = TextView(this).apply {
            textSize = 15f
            setPadding(dp(14), dp(14), dp(14), dp(14))
            setBackgroundColor(0xFFF0F4F8.toInt())
        }
        container.addView(apiHistoryValuesText, matchWidthParams())
        refreshApiHistoryView()
    }

    private fun saveApiKey() {
        try {
            apiSettings.save(apiKeyInput.text.toString())
            apiKeyInput.text.clear()
            apiStatusText.setTextColor(0xFF176B3A.toInt())
            apiStatusText.text = "Schreibschlüssel ist geschützt gespeichert. Der erste Upload wurde gestartet."
            HealthExportWorker.runNow(this)
            refreshApiHistory()
        } catch (error: Exception) {
            apiStatusText.setTextColor(0xFFB42318.toInt())
            apiStatusText.text = error.message ?: "Der Schreibschlüssel konnte nicht gespeichert werden."
        }
    }

    private fun refreshApiHistory() {
        if (apiHistoryLoading || !::apiHistoryStatusText.isInitialized) return
        val settings = try {
            apiSettings.load()
        } catch (error: Exception) {
            apiHistoryStatusText.text = error.message ?: "Der API-Schlüssel konnte nicht gelesen werden."
            return
        }
        if (settings == null) {
            apiHistoryStatusText.text = "Zum Laden der API-Werte zuerst den Handy-Schlüssel speichern."
            return
        }
        apiHistoryLoading = true
        apiHistoryStatusText.text = "API-Werte werden geladen …"
        lifecycleScope.launch {
            try {
                val records = withContext(Dispatchers.IO) {
                    PersonalApiReader(settings).fetchAll(LocalDate.now(timezone)).also {
                        apiHistoryStore.save(it)
                    }
                }
                apiRecords = records
                refreshApiHistoryView()
                if (::manualDateButton.isInitialized && manualFormSnapshot() == manualFormBaseline) {
                    loadSelectedManualDay()
                }
            } catch (error: Exception) {
                apiHistoryStatusText.text = buildString {
                    append("API-Abruf fehlgeschlagen: ")
                    append(error.message ?: error.javaClass.simpleName)
                    if (apiRecords.isNotEmpty()) append(". Zuletzt geladene Werte bleiben sichtbar.")
                }
            } finally {
                apiHistoryLoading = false
            }
        }
    }

    private fun showApiHistoryDatePicker() {
        DatePickerDialog(
            this,
            { _, year, month, dayOfMonth ->
                selectedManualDay = LocalDate.of(year, month + 1, dayOfMonth)
                if (::manualDateButton.isInitialized) loadSelectedManualDay()
                refreshApiHistoryView()
                refreshSelectedDayHealthSteps()
            },
            selectedManualDay.year,
            selectedManualDay.monthValue - 1,
            selectedManualDay.dayOfMonth,
        ).apply {
            datePicker.minDate = LocalDate.now(timezone).minusYears(1)
                .atStartOfDay(timezone).toInstant().toEpochMilli()
        }.show()
    }

    private fun showStoredApiDays() {
        val days = apiRecords.map(ApiRecord::day).distinct().sortedDescending()
        if (days.isEmpty()) {
            apiHistoryStatusText.text = "Noch keine API-Werte geladen."
            return
        }
        val labels = days.map {
            it.format(DateTimeFormatter.ofPattern("EEEE, dd.MM.yyyy", Locale.GERMAN))
        }.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle("Gespeicherter API-Tag")
            .setItems(labels) { _, which ->
                selectedManualDay = days[which]
                if (::manualDateButton.isInitialized) loadSelectedManualDay()
                refreshApiHistoryView()
                refreshSelectedDayHealthSteps()
            }
            .show()
    }

    private fun refreshApiHistoryView() {
        if (!::apiHistoryValuesText.isInitialized) return
        val dayLabel = selectedManualDay.format(
            DateTimeFormatter.ofPattern("EEEE, dd.MM.yyyy", Locale.GERMAN),
        )
        apiHistoryDateButton.text = "API-Datum: $dayLabel"
        val days = apiRecords.map(ApiRecord::day).distinct().size
        apiHistoryStatusText.text = if (apiHistoryLoading) {
            "API-Werte werden geladen …"
        } else {
            "$days Tage und ${apiRecords.size} Werte ab 2026 aus der API verfügbar."
        }
        val selected = apiRecords.filter { it.day == selectedManualDay }
        val dayValues = if (selected.isEmpty()) {
            "Für $dayLabel sind noch keine Werte aus der API geladen."
        } else {
            buildString {
                append(dayLabel)
                selected.groupBy(ApiRecord::namespace).forEach { (namespace, records) ->
                    append("\n\n")
                    append(apiNamespaceLabel(namespace))
                    records.forEach { record ->
                        append("\n")
                        append(apiMetricLabel(record.metric))
                        append(": ")
                        append(record.value)
                    }
                }
            }
        }
        apiHistoryValuesText.text = dayValues
        if (::manualExistingValuesText.isInitialized) {
            manualExistingValuesText.text = dayValues
        }
    }

    private fun apiNamespaceLabel(namespace: String): String = when (namespace) {
        "fitness.health" -> "Health Connect"
        "fitness.manual" -> "Von Hand eingetragen"
        "fitness.gymprogress" -> "Historische Werte"
        else -> namespace
    }

    private fun apiMetricLabel(metric: String): String = when (metric) {
        "steps" -> "Schritte"
        "weight_kg" -> "Gewicht (kg)"
        "nutrition_kcal" -> "Ernährung (kcal)"
        "cycling_km" -> "Fahrradkilometer"
        "training" -> "Training"
        "target_phase" -> "Zielphase"
        "current_phase" -> "Aktuelle Phase"
        "sleep_score" -> "Sleep Score"
        "notes" -> "Sonstiges"
        "sleep_duration_minutes" -> "Schlaf (Minuten)"
        "deep_sleep_minutes" -> "Tiefschlaf (Minuten)"
        "light_sleep_minutes" -> "Leichtschlaf (Minuten)"
        "rem_sleep_minutes" -> "REM-Schlaf (Minuten)"
        "awake_minutes" -> "Wach (Minuten)"
        "resting_heart_rate_bpm" -> "Ruhepuls"
        "sleep_heart_rate_bpm" -> "Schlafpuls"
        else -> metric.replace('_', ' ')
    }

    private fun apiManualValue(metric: String): Any? = apiRecords.firstOrNull {
        it.day == selectedManualDay && it.namespace == "fitness.manual" && it.metric == metric
    }?.value

    private fun refreshSelectedDayHealthSteps() {
        if (!::healthConnectStepsText.isInitialized) return
        val requestId = ++healthStepsRequestId
        val day = selectedManualDay
        if (HealthConnectClient.getSdkStatus(this) != HealthConnectClient.SDK_AVAILABLE) {
            healthConnectStepsText.text = "Health Connect ist nicht verfügbar."
            return
        }
        healthConnectStepsText.text = "Schritte werden aus Health Connect geladen …"
        lifecycleScope.launch {
            try {
                val granted = healthConnectClient.permissionController.getGrantedPermissions()
                if (HealthPermission.getReadPermission(StepsRecord::class) !in granted) {
                    healthConnectStepsText.text = "Schrittzugriff in Health Connect fehlt."
                    return@launch
                }
                val reading = withContext(Dispatchers.IO) {
                    HealthConnectExporter(this@MainActivity).readPreferredSteps(day)
                }
                if (requestId == healthStepsRequestId) {
                    healthConnectStepsText.text = buildString {
                        stepCorrectionStore.get(day)?.let { corrected ->
                            append("Schritte für API nach Google-Health-Korrektur: $corrected\n")
                        }
                        if (reading == null) {
                            append("Keine Schritte in Health Connect vorhanden.")
                        } else {
                            append("Schritte von ${reading.source} in Health Connect: ${reading.count}")
                        }
                    }
                }
            } catch (error: Exception) {
                if (requestId == healthStepsRequestId) {
                    healthConnectStepsText.text = "Health Connect konnte die Schritte nicht lesen: ${error.javaClass.simpleName}"
                }
            }
        }
    }

    private fun manualFormSnapshot(): List<String> = listOf(
        selectedManualDay.toString(),
        manualCyclingInput.text.toString(),
        manualSleepScoreInput.text.toString(),
        manualTrainingSpinner.selectedItemPosition.toString(),
        manualTargetPhaseSpinner.selectedItemPosition.toString(),
        manualCurrentPhaseSpinner.selectedItemPosition.toString(),
        manualNotesInput.text.toString(),
    )

    private fun buildManualContent(container: LinearLayout, dp: (Int) -> Int) {
        container.addView(TextView(this).apply {
            setBackgroundColor(0xFFD8DEE8.toInt())
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)).apply {
            topMargin = dp(28)
            bottomMargin = dp(24)
        })

        container.addView(TextView(this).apply {
            text = "Manuelle Tageswerte"
            textSize = 23f
            setTypeface(typeface, Typeface.BOLD)
        }, matchWidthParams())
        container.addView(TextView(this).apply {
            text = (
                "Fahrradkilometer, Training, Zielphase, aktuelle Phase, Sleep Score " +
                    "und Sonstiges für ein Datum speichern. Leere Felder verändern nichts."
                )
            textSize = 15f
            setPadding(0, dp(8), 0, dp(8))
        }, matchWidthParams())

        addManualLabel(container, "Datum", dp)
        manualDateButton = Button(this).apply {
            setOnClickListener { showManualDatePicker() }
        }
        container.addView(manualDateButton, matchWidthParams())
        manualExistingValuesText = TextView(this).apply {
            textSize = 14f
            setPadding(dp(14), dp(14), dp(14), dp(14))
            setBackgroundColor(0xFFF0F4F8.toInt())
        }
        container.addView(manualExistingValuesText, matchWidthParams())
        refreshApiHistoryView()

        addManualLabel(container, "Fahrradkilometer", dp)
        manualCyclingInput = EditText(this).apply {
            hint = "zum Beispiel 12,5"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
            maxLines = 1
        }
        container.addView(manualCyclingInput, matchWidthParams())

        addManualLabel(container, "Sleep Score", dp)
        manualSleepScoreInput = EditText(this).apply {
            hint = "0 bis 100"
            inputType = InputType.TYPE_CLASS_NUMBER
            maxLines = 1
        }
        container.addView(manualSleepScoreInput, matchWidthParams())

        addManualLabel(container, "Training", dp)
        manualTrainingSpinner = createManualSpinner(TRAINING_OPTIONS)
        container.addView(manualTrainingSpinner, matchWidthParams())

        addManualLabel(container, "Zielphase", dp)
        manualTargetPhaseSpinner = createManualSpinner(PHASE_OPTIONS)
        container.addView(manualTargetPhaseSpinner, matchWidthParams())

        addManualLabel(container, "Aktuelle Phase", dp)
        manualCurrentPhaseSpinner = createManualSpinner(PHASE_OPTIONS)
        container.addView(manualCurrentPhaseSpinner, matchWidthParams())

        container.addView(TextView(this).apply {
            text = "Die Auswahllisten zeigen genau die Farben aus Blatt 2, Spalte O."
            textSize = 13f
            setTextColor(Color.DKGRAY)
            setPadding(0, dp(8), 0, 0)
        }, matchWidthParams())

        addManualLabel(container, "Sonstiges", dp)
        manualNotesInput = EditText(this).apply {
            hint = "Freier Tageshinweis"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            gravity = Gravity.TOP
            minLines = 3
            maxLines = 6
        }
        container.addView(manualNotesInput, matchWidthParams())

        container.addView(Button(this).apply {
            text = "Speichern und an API senden"
            setOnClickListener { saveSelectedManualDay() }
        }, matchWidthParams())
        manualRemoveButton = Button(this).apply {
            text = "Vormerkung für dieses Datum entfernen"
            setOnClickListener { removeSelectedManualDay() }
        }
        container.addView(manualRemoveButton, matchWidthParams())

        manualStatusText = TextView(this).apply {
            textSize = 14f
            setPadding(dp(14), dp(14), dp(14), dp(14))
            setBackgroundColor(0xFFF0F4F8.toInt())
        }
        container.addView(manualStatusText, matchWidthParams())
        loadSelectedManualDay()
    }

    private fun addManualLabel(container: LinearLayout, textValue: String, dp: (Int) -> Int) {
        container.addView(TextView(this).apply {
            text = textValue
            textSize = 14f
            setTypeface(typeface, Typeface.BOLD)
            setPadding(0, dp(14), 0, 0)
        }, matchWidthParams())
    }

    private fun createManualSpinner(options: List<ManualColorOption>): Spinner = Spinner(this).apply {
        adapter = ManualOptionAdapter(
            this@MainActivity,
            listOf(ManualUiOption("Nicht ändern", null)) + options.map {
                ManualUiOption(it.label, it.argb)
            },
        )
    }

    private fun showManualDatePicker() {
        DatePickerDialog(
            this,
            { _, year, month, dayOfMonth ->
                selectedManualDay = LocalDate.of(year, month + 1, dayOfMonth)
                loadSelectedManualDay()
                refreshApiHistoryView()
                refreshSelectedDayHealthSteps()
            },
            selectedManualDay.year,
            selectedManualDay.monthValue - 1,
            selectedManualDay.dayOfMonth,
        ).show()
    }

    private fun loadSelectedManualDay() {
        manualDateButton.text = selectedManualDay.format(
            DateTimeFormatter.ofPattern("EEEE, dd.MM.yyyy", Locale.GERMAN),
        )
        val pending = runCatching { manualEntryStore.pendingEntryFor(selectedManualDay) }
            .getOrElse { error ->
                showManualError(error.message ?: "Manuelle Werte konnten nicht gelesen werden.")
                return
            }
        val confirmed = runCatching { manualEntryStore.confirmedEntryFor(selectedManualDay) }
            .getOrNull()
        val cycling = pending?.cyclingKm
            ?: (apiManualValue("cycling_km") as? Number)?.toDouble()
            ?: confirmed?.cyclingKm
        val sleepScore = pending?.sleepScore
            ?: (apiManualValue("sleep_score") as? Number)?.toInt()
            ?: confirmed?.sleepScore
        manualCyclingInput.setText(cycling?.let(::formatDecimal).orEmpty())
        manualSleepScoreInput.setText(sleepScore?.toString().orEmpty())
        setSpinnerSelection(manualTrainingSpinner,
            pending?.training ?: (apiManualValue("training") as? String) ?: confirmed?.training)
        setSpinnerSelection(manualTargetPhaseSpinner,
            pending?.targetPhase ?: (apiManualValue("target_phase") as? String) ?: confirmed?.targetPhase)
        setSpinnerSelection(manualCurrentPhaseSpinner,
            pending?.currentPhase ?: (apiManualValue("current_phase") as? String) ?: confirmed?.currentPhase)
        manualNotesInput.setText(
            pending?.notes ?: (apiManualValue("notes") as? String) ?: confirmed?.notes ?: "",
        )
        manualRemoveButton.isEnabled = pending != null
        refreshManualStatus(
            if (pending != null) {
                "Für dieses Datum ist bereits eine Vormerkung gespeichert."
            } else if (apiRecords.any { it.day == selectedManualDay && it.namespace == "fitness.manual" }) {
                "Für dieses Datum sind bereits manuelle Werte in der API gespeichert."
            } else if (confirmed != null) {
                "Für dieses Datum liegt eine zuletzt bestätigte Eingabe auf dem Handy vor."
            } else {
                "Für dieses Datum ist noch nichts vorgemerkt."
            },
        )
        manualFormBaseline = manualFormSnapshot()
    }

    private fun saveSelectedManualDay() {
        try {
            val cyclingText = manualCyclingInput.text.toString().trim()
            val cycling = cyclingText.takeIf { it.isNotEmpty() }
                ?.replace(',', '.')
                ?.toDoubleOrNull()
                ?: cyclingText.takeIf { it.isNotEmpty() }?.let {
                    throw IllegalArgumentException("Fahrradkilometer müssen eine Zahl sein.")
                }
            val scoreText = manualSleepScoreInput.text.toString().trim()
            val sleepScore = scoreText.takeIf { it.isNotEmpty() }
                ?.toIntOrNull()
                ?: scoreText.takeIf { it.isNotEmpty() }?.let {
                    throw IllegalArgumentException("Sleep Score muss eine ganze Zahl sein.")
                }
            val saved = manualEntryStore.upsert(
                ManualEntry(
                    day = selectedManualDay,
                    revision = 0,
                    cyclingKm = cycling,
                    training = selectedManualLabel(manualTrainingSpinner),
                    targetPhase = selectedManualLabel(manualTargetPhaseSpinner),
                    currentPhase = selectedManualLabel(manualCurrentPhaseSpinner),
                    sleepScore = sleepScore,
                    notes = manualNotesInput.text.toString(),
                ),
            )
            manualRemoveButton.isEnabled = true
            HealthExportWorker.runNow(this)
            manualFormBaseline = manualFormSnapshot()
            refreshManualStatus(
                "${saved.day.format(DateTimeFormatter.ofPattern("dd.MM.yyyy"))} ist gespeichert; der API-Versand wurde gestartet.",
            )
        } catch (error: IllegalArgumentException) {
            showManualError(error.message ?: "Bitte die manuellen Werte prüfen.")
        } catch (error: Exception) {
            showManualError("Speichern fehlgeschlagen: ${error.javaClass.simpleName}")
        }
    }

    private fun removeSelectedManualDay() {
        try {
            val removed = manualEntryStore.remove(selectedManualDay)
            if (removed) {
                manualCyclingInput.text.clear()
                manualSleepScoreInput.text.clear()
                setSpinnerSelection(manualTrainingSpinner, null)
                setSpinnerSelection(manualTargetPhaseSpinner, null)
                setSpinnerSelection(manualCurrentPhaseSpinner, null)
                manualNotesInput.text.clear()
                manualRemoveButton.isEnabled = false
                manualFormBaseline = manualFormSnapshot()
                refreshManualStatus("Die Vormerkung für dieses Datum wurde entfernt.")
            }
        } catch (error: Exception) {
            showManualError("Entfernen fehlgeschlagen: ${error.javaClass.simpleName}")
        }
    }

    private fun selectedManualLabel(spinner: Spinner): String? =
        (spinner.selectedItem as? ManualUiOption)?.label?.takeUnless { it == "Nicht ändern" }

    private fun setSpinnerSelection(spinner: Spinner, label: String?) {
        val adapter = spinner.adapter as ManualOptionAdapter
        val position = (0 until adapter.count).firstOrNull {
            adapter.getItem(it)?.label == label
        } ?: 0
        spinner.setSelection(position)
    }

    private fun refreshManualStatus(message: String) {
        val count = runCatching { manualEntryStore.loadEntries().size }.getOrDefault(0)
        manualStatusText.setTextColor(Color.DKGRAY)
        manualStatusText.text = buildString {
            append(message)
            append("\n")
            append(if (count == 1) "1 Tag ist vorgemerkt." else "$count Tage sind vorgemerkt.")
        }
    }

    private fun showManualError(message: String) {
        manualStatusText.setTextColor(0xFFB42318.toInt())
        manualStatusText.text = message
    }

    private fun formatDecimal(value: Double): String =
        if (value % 1.0 == 0.0) value.toLong().toString() else value.toString().replace('.', ',')

    private fun matchWidthParams() = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
    ).apply {
        topMargin = (12 * resources.displayMetrics.density).toInt()
    }

    private fun backgroundReadAvailable(): Boolean =
        healthConnectClient.features.getFeatureStatus(
            HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND,
        ) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE

    private fun requiredPermissions(): Set<String> = buildSet {
        addAll(healthReadPermissions())
        if (backgroundReadAvailable()) {
            add(HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND)
        }
    }

    private fun refreshPermissionState() {
        val sdkStatus = HealthConnectClient.getSdkStatus(this)
        if (sdkStatus != HealthConnectClient.SDK_AVAILABLE) {
            statusText.text =
                "Health Connect ist auf diesem Gerät nicht verfügbar oder muss aktualisiert werden."
            exportButton.isEnabled = false
            return
        }

        lifecycleScope.launch {
            val granted = healthConnectClient.permissionController.getGrantedPermissions()
            exportButton.isEnabled = granted.containsAll(healthReadPermissions())
            if (!backgroundReadAvailable()) {
                statusText.text =
                    "Manueller Health-Export ist möglich; Hintergrundzugriff wird nicht unterstützt."
                return@launch
            }

            val required = requiredPermissions()
            if (granted.containsAll(required)) {
                HealthExportWorker.schedule(this@MainActivity)
                val preferences = getSharedPreferences(
                    HealthExportWorker.PREFERENCES_NAME,
                    MODE_PRIVATE,
                )
                val lastStatus = preferences.getString(
                    HealthExportWorker.KEY_LAST_STATUS,
                    null,
                )
                val lastAttempt = preferences.getString(
                    HealthExportWorker.KEY_LAST_ATTEMPT,
                    null,
                )
                statusText.text = buildString {
                    append("Automatik aktiv: API-Upload täglich ungefähr 02:30 Uhr.")
                    if (lastStatus != null) append("\nLetzter Status: $lastStatus")
                    if (lastAttempt != null) append("\nLetzter Versuch: $lastAttempt")
                }
            } else {
                statusText.text =
                    "Bitte erlauben Sie einmalig alle Health- und Hintergrundzugriffe."
            }
        }
    }

    private fun exportRecentHealth() {
        exportButton.isEnabled = false
        HealthExportWorker.runNow(this)
        statusText.text =
            "Der 30-Tage-Upload wurde gestartet. Der Status aktualisiert sich nach Abschluss."
        exportButton.postDelayed({
            exportButton.isEnabled = true
            refreshPermissionState()
        }, 8_000L)
    }

}
