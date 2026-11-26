package org.lifeos.beta

import android.content.Context
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate


internal data class ApiRecord(
    val day: LocalDate,
    val namespace: String,
    val metric: String,
    val value: Any,
    val source: String,
    val updatedAt: String,
)

internal fun parseApiRecords(payload: JSONObject): List<ApiRecord> {
    require(payload.getInt("schema_version") == 1) { "Unbekannte API-Version." }
    val records = payload.getJSONArray("records")
    val result = ArrayList<ApiRecord>(records.length())
    val seen = HashSet<Triple<LocalDate, String, String>>()
    for (index in 0 until records.length()) {
        val raw = records.getJSONObject(index)
        val day = LocalDate.parse(raw.getString("date"))
        val namespace = raw.getString("namespace")
        val metric = raw.getString("metric")
        require(namespace.matches(Regex("[a-z0-9]+(?:[._][a-z0-9]+)*"))) {
            "Ungültiger API-Namespace."
        }
        require(metric.matches(Regex("[a-z0-9]+(?:_[a-z0-9]+)*"))) {
            "Ungültige API-Metrik."
        }
        require(seen.add(Triple(day, namespace, metric))) { "Doppelte API-Metrik." }
        val value = raw.get("value")
        require(value is String || value is Number || value is Boolean) {
            "Ungültiger API-Wert."
        }
        result += ApiRecord(
            day = day,
            namespace = namespace,
            metric = metric,
            value = value,
            source = raw.getString("source"),
            updatedAt = raw.getString("updated_at"),
        )
    }
    return result
}

internal fun apiHistoryYears(today: LocalDate): List<Pair<LocalDate, LocalDate>> {
    val first = today.minusYears(1)
    if (today.isBefore(first)) return emptyList()
    return (first.year..today.year).map { year ->
        maxOf(LocalDate.of(year, 1, 1), first) to minOf(LocalDate.of(year, 12, 31), today)
    }
}

internal class PersonalApiReader(private val settings: PersonalApiSettings) {
    fun fetchAll(today: LocalDate): List<ApiRecord> {
        val baseUrl = validateApiBaseUrl(settings.baseUrl)
        val result = mutableListOf<ApiRecord>()
        for ((from, to) in apiHistoryYears(today)) {
            val connection = URL("$baseUrl/data.php?from=$from&to=$to")
                .openConnection() as HttpURLConnection
            try {
                connection.requestMethod = "GET"
                connection.connectTimeout = 15_000
                connection.readTimeout = 30_000
                connection.instanceFollowRedirects = false
                connection.setRequestProperty("Accept", "application/json")
                connection.setRequestProperty("X-GymProgress-Key", settings.writeToken)
                connection.setRequestProperty("User-Agent", "Life-OS-Android/0.1-beta")
                val status = connection.responseCode
                if (status != HttpURLConnection.HTTP_OK) {
                    throw IOException("API-Abruf fehlgeschlagen: HTTP $status")
                }
                val payload = JSONObject(readLimited(connection.inputStream).toString(Charsets.UTF_8))
                require(payload.getString("from") == from.toString() &&
                    payload.getString("to") == to.toString()) {
                    "Die API antwortete für einen anderen Zeitraum."
                }
                result += parseApiRecords(payload)
            } finally {
                connection.disconnect()
            }
        }
        return result.sortedWith(compareBy(ApiRecord::day, ApiRecord::namespace, ApiRecord::metric))
    }

    private fun readLimited(input: java.io.InputStream): ByteArray = input.use { stream ->
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
            val count = stream.read(buffer)
            if (count < 0) break
            if (output.size() + count > MAX_RESPONSE_BYTES) {
                throw IOException("Die API-Antwort ist unerwartet groß.")
            }
            output.write(buffer, 0, count)
        }
        output.toByteArray()
    }

    companion object {
        private const val MAX_RESPONSE_BYTES = 8_000_000
    }
}

internal class ApiHistoryStore(context: Context) {
    private val scope = dashboardScope(DashboardConnection(context).destination())
    private val file = AtomicFile(File(context.filesDir, "gymprogress_api_history$scope.json"))

    fun load(): List<ApiRecord> = try {
        parseApiRecords(JSONObject(file.openRead().bufferedReader(Charsets.UTF_8).use { it.readText() }))
    } catch (_: java.io.FileNotFoundException) {
        emptyList()
    }

    fun save(records: List<ApiRecord>) {
        val days = JSONArray()
        records.forEach { record ->
            days.put(JSONObject()
                .put("date", record.day.toString())
                .put("namespace", record.namespace)
                .put("metric", record.metric)
                .put("value", record.value)
                .put("source", record.source)
                .put("updated_at", record.updatedAt))
        }
        val content = JSONObject().put("schema_version", 1).put("records", days)
            .toString().toByteArray(Charsets.UTF_8)
        val stream = file.startWrite()
        try {
            stream.write(content)
            file.finishWrite(stream)
        } catch (error: Exception) {
            file.failWrite(stream)
            throw error
        }
    }
}
